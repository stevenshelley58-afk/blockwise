create extension if not exists pgtap with schema extensions;

begin;
select plan(10);

insert into public.workspaces (id, name, mode, region)
values
  ('96666666-6666-4666-8666-666666666666', 'Unassigned destination', 'self_serve', 'AU'),
  ('97777777-7777-4777-8777-777777777777', 'Wrong destination', 'self_serve', 'AU')
on conflict (id) do nothing;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '98888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated', 'assignment-operator@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'assignment-assignee@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, is_operator, operator_role)
values
  ('98888888-8888-4888-8888-888888888888', 'assignment-operator@example.test', 'Assignment Operator', true, 'support'),
  ('99999999-9999-4999-8999-999999999999', 'assignment-assignee@example.test', 'Assignment Assignee', false, null)
on conflict (id) do update set is_operator = excluded.is_operator, operator_role = excluded.operator_role;
insert into public.workspace_members (workspace_id, profile_id, role)
values
  ('96666666-6666-4666-8666-666666666666', '98888888-8888-4888-8888-888888888888', 'owner'),
  ('96666666-6666-4666-8666-666666666666', '99999999-9999-4999-8999-999999999999', 'member')
on conflict (workspace_id, profile_id) do nothing;

select has_function('public', 'assign_ops_enquiry', array['uuid', 'uuid', 'uuid', 'bigint', 'uuid'], 'assignment RPC is installed');
insert into public.ops_enquiry_associations (id, workspace_id, source_system, source_id, enquiry_type, subject)
values ('a1111111-1111-4111-8111-111111111111', null, 'crm', 'global-assignment-1', 'sales', 'Global enquiry');
select lives_ok($$ select public.enqueue_ops_action(
  'a2222222-2222-4222-8222-222222222222', 'ops:test:global-assignment:1',
  '96666666-6666-4666-8666-666666666666', '96666666-6666-4666-8666-666666666666',
  'enquiry_assign', 'enquiry', 'a1111111-1111-4111-8111-111111111111',
  '98888888-8888-4888-8888-888888888888', 'support', 'aal2', 1,
  'Assign global enquiry', now() - interval '1 minute', now() + interval '1 hour',
  '{"assigneeProfileId":"99999999-9999-4999-8999-999999999999"}'::jsonb
) $$, 'global enquiry assignment action is accepted');
select is(public.assign_ops_enquiry('96666666-6666-4666-8666-666666666666', 'a1111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 1, '98888888-8888-4888-8888-888888888888'), true, 'global enquiry binds atomically once');
select is((select workspace_id from public.ops_enquiry_associations where id = 'a1111111-1111-4111-8111-111111111111'), '96666666-6666-4666-8666-666666666666'::uuid, 'assignment sets destination workspace');
select is((select assignee_profile_id from public.ops_enquiry_associations where id = 'a1111111-1111-4111-8111-111111111111'), '99999999-9999-4999-8999-999999999999'::uuid, 'assignment records workspace member assignee');
select ok(exists (select 1 from public.ops_projection_outbox where workspace_id = '96666666-6666-4666-8666-666666666666' and provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = 'a1111111-1111-4111-8111-111111111111'), 'binding emits destination Chatwoot projection');
select is(public.assign_ops_enquiry('97777777-7777-4777-8777-777777777777', 'a1111111-1111-4111-8111-111111111111', null, 2, '98888888-8888-4888-8888-888888888888'), false, 'already-owned enquiry rejects wrong tenant');
select is(public.assign_ops_enquiry('96666666-6666-4666-8666-666666666666', 'a1111111-1111-4111-8111-111111111111', null, 1, '98888888-8888-4888-8888-888888888888'), false, 'stale assignment version is rejected');

insert into public.ops_enquiry_associations (id, workspace_id, source_system, source_id, enquiry_type, subject)
values ('a3333333-3333-4333-8333-333333333333', null, 'crm', 'global-assignment-close', 'support', 'Still unassigned');
select throws_ok($$ select public.enqueue_ops_action(
  'a4444444-4444-4444-8444-444444444444', 'ops:test:global-close:1',
  '96666666-6666-4666-8666-666666666666', '96666666-6666-4666-8666-666666666666',
  'enquiry_close', 'enquiry', 'a3333333-3333-4333-8333-333333333333',
  '98888888-8888-4888-8888-888888888888', 'support', 'aal2', 1,
  'Close must remain workspace-bound', now() - interval '1 minute', now() + interval '1 hour', '{}'
) $$, '42501', 'operations action target is not owned by workspace', 'global close remains blocked');
select throws_ok($$ select public.enqueue_ops_action(
  'a5555555-5555-4555-8555-555555555555', 'ops:test:global-reply:1',
  '96666666-6666-4666-8666-666666666666', '96666666-6666-4666-8666-666666666666',
  'enquiry_reply', 'enquiry', 'a3333333-3333-4333-8333-333333333333',
  '98888888-8888-4888-8888-888888888888', 'support', 'aal2', 1,
  'Reply must remain workspace-bound', now() - interval '1 minute', now() + interval '1 hour', '{"body":"No cross-tenant reply"}'
) $$, '42501', 'operations action target is not owned by workspace', 'global reply remains blocked');

select * from finish();
rollback;
