create extension if not exists pgtap with schema extensions;

begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'authority-admin@test.local', '', '{}', '{}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'authority-owner@test.local', '', '{}', '{}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'authority-target@test.local', '', '{}', '{}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'authority-membership@test.local', '', '{}', '{}', now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, is_operator, operator_role)
values
  ('e1000000-0000-4000-8000-000000000001', 'authority-admin@test.local', false, null),
  ('e2000000-0000-4000-8000-000000000002', 'authority-owner@test.local', true, 'owner'),
  ('e5000000-0000-4000-8000-000000000005', 'authority-membership@test.local', false, null),
  ('e3000000-0000-4000-8000-000000000003', 'authority-target@test.local', false, null)
on conflict (id) do nothing;

insert into public.workspaces (id, name, mode, region, created_by)
values ('e4000000-0000-4000-8000-000000000004', 'Authority Workspace', 'monitor', 'AU', 'e2000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- Operator memberships are service-managed, so seed the fixture through the
-- same privileged role used by the production RPC before testing client denial.
set local role service_role;
insert into public.workspace_members (workspace_id, profile_id, role)
values
  ('e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'admin'),
  ('e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000003', 'member'),
  ('e4000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000005', 'operator')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"e5000000-0000-4000-8000-000000000005"}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000005', true);
select is(public.is_operator(), false, 'membership-only operator is not a platform operator');
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}', true);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ update public.workspace_members
     set role = 'operator'
     where workspace_id = 'e4000000-0000-4000-8000-000000000004'
       and profile_id = 'e3000000-0000-4000-8000-000000000003' $$,
  'workspace operator membership is service-managed',
  'workspace admin cannot promote a member to operator'
);

select throws_ok(
  $$ select public.set_operator_role('e3000000-0000-4000-8000-000000000003', 'support') $$,
  'operator_owner_required',
  'non-owner cannot assign a platform operator role'
);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"e2000000-0000-4000-8000-000000000002"}', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select public.set_operator_role('e3000000-0000-4000-8000-000000000003', 'owner') $$,
  'owner can assign a platform owner role'
);

select is(
  (select is_operator and operator_role = 'owner' from public.profiles where id = 'e3000000-0000-4000-8000-000000000003'),
  true,
  'owner assignment sets both canonical authority fields'
);

select lives_ok(
  $$ select public.set_operator_role('e2000000-0000-4000-8000-000000000002', null) $$,
  'owner can demote themselves when another owner exists'
);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"e3000000-0000-4000-8000-000000000003"}', true);
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$ select public.set_operator_role('e3000000-0000-4000-8000-000000000003', null) $$,
  'last_operator_owner',
  'last owner cannot be removed'
);

select * from finish();
rollback;
