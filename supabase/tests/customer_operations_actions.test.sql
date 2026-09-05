create extension if not exists pgtap with schema extensions;

begin;
select plan(58);

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
select ok(not has_table_privilege('service_role', 'public.ops_action_capabilities', 'INSERT'), 'service_role cannot directly insert capabilities');
select ok(not has_table_privilege('service_role', 'public.ops_action_capabilities', 'UPDATE'), 'service_role cannot directly update capabilities');
select ok(not has_table_privilege('service_role', 'public.ops_action_capabilities', 'DELETE'), 'service_role cannot directly delete capabilities');
select is((select count(*)::int from public.ops_action_capabilities), 24, 'all agreed actions have a capability entry');
select is((select capability_state from public.ops_action_capabilities where action_type = 'team_suspend'), 'unsupported', 'suspension is explicitly unsupported');
select is((select capability_state from public.ops_action_capabilities where action_type = 'team_role_change'), 'available', 'role changes are owner-only CAS protected');
select is((select capability_state from public.ops_action_capabilities where action_type = 'billing_portal_link'), 'capability_required', 'billing portal links are explicitly gated until an executor exists');

insert into public.workspaces (id, name, mode, region)
values ('86666666-6666-4666-8666-666666666666', 'Action contract test', 'self_serve', 'AU')
on conflict (id) do nothing;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '87777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'ops-action-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, is_operator, operator_role)
values ('87777777-7777-4777-8777-777777777777', 'ops-action-owner@example.test', 'Action Owner', true, 'owner')
on conflict (id) do update set is_operator = true, operator_role = 'owner';
insert into public.workspace_members (workspace_id, profile_id, role)
values ('86666666-6666-4666-8666-666666666666', '87777777-7777-4777-8777-777777777777', 'owner')
on conflict (workspace_id, profile_id) do nothing;

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888881', 'ops:test:invite:v1',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'Customer requested team access', now() - interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member"}'::jsonb
) $$, 'available action is accepted through the RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'pending', 'accepted action starts pending');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'pending'), 1, 'accepted action has an immutable pending receipt');
select is((select count(*)::int from public.claim_ops_action(60)), 1, 'worker can claim through the RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'processing', 'claim is atomic');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'processing'), 1, 'claim records a processing receipt');
select is(public.fail_ops_action((select id from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), (select lease_token from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'temporary worker failure', true), 'pending', 'retry transition is durable');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'pending'), 2, 'repeated pending transitions retain separate receipts');

update public.workspaces set updated_at=now() where id='86666666-6666-4666-8666-666666666666';
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888882', 'ops:test:invite:v2',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 2,
  'Customer updated the invite request', now() - interval '1 hour', now() + interval '2 hours',
  '{"email":"invite-2@example.test","role":"admin"}'::jsonb
) $$, 'newer action version is accepted');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), 'superseded', 'newer version fences processing action');
select is((select count(*)::int from public.ops_action_receipts where action_id = '88888888-8888-4888-8888-888888888881' and status = 'superseded'), 1, 'supersession is durably receipted');
select ok(not public.complete_ops_action((select id from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888881'), gen_random_uuid(), '{}'::jsonb), 'stale action cannot settle');
select is((select count(*)::int from public.claim_ops_action(60)), 1, 'newer action is claimable');
select ok(public.complete_ops_action((select id from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), (select lease_token from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), '{"status":"accepted"}'::jsonb), 'current action settles through RPC');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888882'), 'completed', 'settlement status is durable');

-- Source-row versions, rather than queue ordering, are the authoritative CAS.
update public.workspaces set updated_at=now() where id='86666666-6666-4666-8666-666666666666';
insert into public.workspace_invitations (id,workspace_id,email,email_normalized,role,invited_by)
values ('89999999-9999-4999-8999-999999999999','86666666-6666-4666-8666-666666666666','invite-target@example.test','invite-target@example.test','member','87777777-7777-4777-8777-777777777777')
on conflict (id) do nothing;
update public.workspace_invitations set updated_at=now() where id='89999999-9999-4999-8999-999999999999';
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888889', 'ops:test:stale-invitation',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_cancel', 'invitation', '89999999-9999-4999-8999-999999999999',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'stale invitation test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, '40001', 'operations action target version is stale', 'stale invitation versions reject');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888890', 'ops:test:current-invitation',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_cancel', 'invitation', '89999999-9999-4999-8999-999999999999',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_invitations where id='89999999-9999-4999-8999-999999999999'),
  'current invitation test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'current invitation versions pass');

update public.workspace_members set role='admin' where workspace_id='86666666-6666-4666-8666-666666666666' and profile_id='87777777-7777-4777-8777-777777777777';
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888891', 'ops:test:stale-session',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'session_revoke', 'session', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'stale session test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, '40001', 'operations action target version is stale', 'stale member versions reject');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888892', 'ops:test:current-session',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'session_revoke', 'session', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 2,
  'current session test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'current member versions pass');

insert into public.ops_enquiry_associations (id,workspace_id,source_system,source_id,enquiry_type,status,subject)
values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','86666666-6666-4666-8666-666666666666','blockwise','action-test-enquiry','support','open','Action test enquiry')
on conflict (id) do nothing;
update public.ops_enquiry_associations set updated_at=now() where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888893', 'ops:test:stale-enquiry',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'enquiry_assign', 'enquiry', '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'stale enquiry test', now()-interval '1 hour', now()+interval '2 hours', '{"assigneeProfileId":null}'::jsonb
) $$, '40001', 'operations action target version is stale', 'stale enquiry versions reject');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888894', 'ops:test:current-enquiry',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'enquiry_assign', 'enquiry', '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 2,
  'current enquiry test', now()-interval '1 hour', now()+interval '2 hours', '{"assigneeProfileId":null}'::jsonb
) $$, 'current enquiry versions pass');

update public.workspaces set updated_at=now() where id='86666666-6666-4666-8666-666666666666';
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888895', 'ops:test:stale-billing',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'billing_reconcile', 'billing', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 2,
  'stale billing test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, '40001', 'operations action target version is stale', 'stale billing versions reject');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888896', 'ops:test:current-billing',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'billing_reconcile', 'billing', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspaces where id='86666666-6666-4666-8666-666666666666'),
  'current billing test', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'current billing versions pass');

select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888883', 'ops:test:role:gated',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_role_change', 'profile', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_members where workspace_id='86666666-6666-4666-8666-666666666666' and profile_id='87777777-7777-4777-8777-777777777777'),
  'Role executor is not enabled', now() - interval '1 hour', now() + interval '2 hours',
  '{"role":"viewer"}'::jsonb
) $$, 'available role action is recorded for execution');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888883'), 'pending', 'available role action is queued explicitly');
select is((select last_error from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888883'), null::text, 'available role action has no capability error');

update public.workspace_members set updated_at=now()
  where workspace_id='86666666-6666-4666-8666-666666666666' and profile_id='87777777-7777-4777-8777-777777777777';
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888884', 'ops:test:suspend:unsupported',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_suspend', 'profile', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_members where workspace_id='86666666-6666-4666-8666-666666666666' and profile_id='87777777-7777-4777-8777-777777777777'),
  'Suspension capability is not implemented', now() - interval '1 hour', now() + interval '2 hours', '{}'::jsonb
) $$, 'unsupported action is recorded without execution');
select is((select status from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888884'), 'rejected', 'unsupported action is rejected explicitly');
select is((select last_error from public.ops_action_outbox where action_id = '88888888-8888-4888-8888-888888888884'), 'unsupported', 'unsupported reason is persisted safely');

select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888888', 'ops:test:cross-workspace',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'cross-workspace target must fail', now() - interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member"}'::jsonb
) $$, '42501', 'operations action target is not owned by workspace', 'cross-workspace targets are rejected before enqueue');

select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888885', 'ops:test:unsafe',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', 1,
  'unsafe payload test', now() - interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member","portalUrl":"https://secret.example"}'::jsonb
) $$, '22023', 'operations action payload is invalid', 'payload fields are strictly allowlisted');
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888886', 'ops:test:aal1',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal1', 1,
  'aal test', now() - interval '1 hour', now() + interval '2 hours',
  '{"email":"invite@example.test","role":"member"}'::jsonb
) $$, '22023', 'invalid operations action identity', 'AAL2 provenance is mandatory');
select throws_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888887', 'ops:test:support-owner',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'session_revoke', 'session', '87777777-7777-4777-8777-777777777777',
  '87777777-7777-4777-8777-777777777777', 'support', 'aal2', 1,
  'support owner test', now() - interval '1 hour', now() + interval '2 hours', '{}'::jsonb
) $$, '42501', 'owner_role_required', 'owner-only actions reject support actors');

-- A second action cannot bypass an unresolved external invite delivery.
insert into public.workspace_invitations (id,workspace_id,email,email_normalized,role,invited_by)
values ('89999999-9999-4999-8999-999999999902','86666666-6666-4666-8666-666666666666','ambiguous@example.test','ambiguous@example.test','member','87777777-7777-4777-8777-777777777777');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888897', 'ops:test:ambiguous-original',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_resend', 'invitation', '89999999-9999-4999-8999-999999999902',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_invitations where id='89999999-9999-4999-8999-999999999902'),
  'ambiguous original delivery', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'original ambiguous invite action is queued');
insert into private.ops_invitation_delivery_ledger(action_id,idempotency_key,workspace_id,invitation_id,state,baseline_send_attempt_count)
values ('88888888-8888-4888-8888-888888888897','ops:test:ambiguous-original',
  '86666666-6666-4666-8666-666666666666','89999999-9999-4999-8999-999999999902','needs_reconciliation',0);
update public.workspace_invitations set updated_at=now()
  where id='89999999-9999-4999-8999-999999999902';
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888900', 'ops:test:new-invite-after-ambiguous',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_resend', 'invitation', '89999999-9999-4999-8999-999999999902',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_invitations where id='89999999-9999-4999-8999-999999999902'),
  'explicit resend after ambiguous delivery', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'new action is queued but delivery reservation remains fenced');
select throws_ok($$ select public.begin_ops_invitation_delivery(
  '88888888-8888-4888-8888-888888888900','ops:test:new-invite-after-ambiguous',
  '86666666-6666-4666-8666-666666666666','89999999-9999-4999-8999-999999999902'
) $$, '55000', 'invitation delivery needs reconciliation', 'unresolved invite cannot be bypassed by a new action');

insert into public.workspace_invitations (id,workspace_id,email,email_normalized,role,invited_by)
values ('89999999-9999-4999-8999-999999999900','86666666-6666-4666-8666-666666666666','invite-native@example.test','invite-native@example.test','member','87777777-7777-4777-8777-777777777777');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888898', 'ops:test:native-invite',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_invite', 'workspace', '86666666-6666-4666-8666-666666666666',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspaces where id='86666666-6666-4666-8666-666666666666'),
  'native invitation reservation', now()-interval '1 hour', now()+interval '2 hours', '{"email":"invite-native@example.test","role":"member"}'::jsonb
) $$, 'team invite workspace action is accepted');
select is((public.begin_ops_invitation_delivery('88888888-8888-4888-8888-888888888898','ops:test:native-invite','86666666-6666-4666-8666-666666666666','89999999-9999-4999-8999-999999999900')->>'state'), 'reserved', 'team invite reserves against its workspace target');

insert into public.workspace_invitations (id,workspace_id,email,email_normalized,role,invited_by)
values ('89999999-9999-4999-8999-999999999901','86666666-6666-4666-8666-666666666666','resend-native@example.test','resend-native@example.test','member','87777777-7777-4777-8777-777777777777');
select lives_ok($$ select public.enqueue_ops_action(
  '88888888-8888-4888-8888-888888888899', 'ops:test:native-resend',
  '86666666-6666-4666-8666-666666666666', '86666666-6666-4666-8666-666666666666',
  'team_resend', 'invitation', '89999999-9999-4999-8999-999999999901',
  '87777777-7777-4777-8777-777777777777', 'owner', 'aal2', (select ops_version from public.workspace_invitations where id='89999999-9999-4999-8999-999999999901'),
  'native resend reservation', now()-interval '1 hour', now()+interval '2 hours', '{}'::jsonb
) $$, 'team resend invitation action is accepted');
select is((public.begin_ops_invitation_delivery('88888888-8888-4888-8888-888888888899','ops:test:native-resend','86666666-6666-4666-8666-666666666666','89999999-9999-4999-8999-999999999901')->>'state'), 'reserved', 'team resend reserves against its invitation target');

select * from finish();
rollback;
