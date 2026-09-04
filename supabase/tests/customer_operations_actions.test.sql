create extension if not exists pgtap with schema extensions;

begin;
select plan(35);

select has_table('public', 'ops_action_capabilities', 'action capability registry exists');
select has_table('public', 'ops_action_outbox', 'action outbox exists');
select has_table('public', 'ops_action_receipts', 'immutable action receipts exist');
select ok((select relrowsecurity from pg_class where oid = 'public.ops_action_outbox'::regclass), 'action outbox RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.ops_action_receipts'::regclass), 'action receipts RLS is enabled');
select ok(not has_table_privilege('service_role', 'public.ops_action_outbox', 'INSERT'), 'service_role cannot directly insert actions');
select ok(not has_table_privilege('service_role', 'public.ops_action_outbox', 'UPDATE'), 'service_role cannot directly update actions');
select ok(not has_table_privilege('service_role', 'public.ops_action_outbox', 'DELETE'), 'service_role cannot directly delete actions');
select ok(not has_table_privilege('service_role', 'public.ops_action_receipts', 'INSERT'), 'service_role cannot directly insert receipts');
select ok(not has_table_privilege('service_role', 'public.ops_action_receipts', 'UPDATE'), 'service_role cannot directly update receipts');
select ok(not has_table_privilege('service_role', 'public.ops_action_receipts', 'DELETE'), 'service_role cannot directly delete receipts');
select is((select count(*)::int from public.ops_action_capabilities), 20, 'all agreed actions have a capability entry');
select is((select capability_state from public.ops_action_capabilities where action_type = 'team_suspend'), 'unsupported', 'suspension is explicitly unsupported');
select is((select capability_state from public.ops_action_capabilities where action_type = 'team_role_change'), 'capability_required', 'role changes are explicitly gated');

insert into public.workspaces (id, name, mode, region)
values ('86666666-6666-4666-8666-666666666666', 'Action contract test', 'self_serve', 'AU')
on conflict (id) do nothing;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '87777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'ops-action-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, is_operator, operator_role)
values ('87777777-7777-4777-8777-777777777777', 'ops-action-owner@example.test', 'Action Owner', true, 'owner')
on conflict (id) do update set is_operator = true, operator_role = 'owner';

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888881', 'ops:test:invite:v1',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'Customer requested team access', now() + interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member"}'::jsonb
) $$, 'available action is accepted through the RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'pending', 'accepted action starts pending');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'pending'), 1, 'accepted action has an immutable pending receipt');
select is((select count(*)::int from public.claim_ops_action(60)), 1, 'worker can claim through the RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'processing', 'claim is atomic');

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888882', 'ops:test:invite:v2',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 2,
  'Customer updated the invite request', now() + interval '1 hour', now() + interval '2 hours',
  '{"email":"invite-2@example.test","role":"admin"}'::jsonb
) $$, 'newer action version is accepted');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'superseded', 'newer version fences processing action');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'superseded'), 1, 'supersession is durably receipted');
select ok(not public.complete_ops_action((select id from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), gen_random_uuid(), '{}'::jsonb), 'stale action cannot settle');
select is((select count(*)::int from public.claim_ops_action(60)), 1, 'newer action is claimable');
select ok(public.complete_ops_action((select id from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), (select lease_token from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), '{"status":"accepted"}'::jsonb), 'current action settles through RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), 'completed', 'settlement status is durable');

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888883', 'ops:test:role:gated',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_role_change', 'profile', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'Role executor is not enabled', now() + interval '1 hour', now() + interval '2 hours',
  '{"role":"viewer"}'::jsonb
) $$, 'capability-gated action is recorded without inventing execution');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888883'), 'rejected', 'capability-gated action is rejected explicitly');
select is((select last_error from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888883'), 'capability_required', 'capability reason is persisted safely');

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888884', 'ops:test:suspend:unsupported',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_suspend', 'profile', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'Suspension capability is not implemented', now() + interval '1 hour', now() + interval '2 hours', '{}'::jsonb
) $$, 'unsupported action is recorded without execution');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888884'), 'rejected', 'unsupported action is rejected explicitly');
select is((select last_error from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888884'), 'unsupported', 'unsupported reason is persisted safely');

select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888885', 'ops:test:unsafe',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'unsafe payload test', now() + interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member","portalUrl":"https://secret.example"}'::jsonb
) $$, '22023', 'operations action payload is invalid', 'payload fields are strictly allowlisted');
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888886', 'ops:test:aal1',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal1', 1,
  'aal test', now() + interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member"}'::jsonb
) $$, '22023', 'invalid operations action identity', 'AAL2 provenance is mandatory');
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888887', 'ops:test:support-owner',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'session_revoke', 'session', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'support', 'aal2', 1,
  'support owner test', now() + interval '1 hour', now() + interval '2 hours', '{}'::jsonb
) $$, '42501', 'owner_role_required', 'owner-only actions reject support actors');

select * from finish();
rollback;
