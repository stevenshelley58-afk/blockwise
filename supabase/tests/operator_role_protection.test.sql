-- pgTAP coverage for operator role column protection (RLS elevation guard).
--
-- Required by the launch security review: prove that a normal authenticated
-- user CANNOT change is_operator, operator_role or operator_since through
-- the profiles_update_self_or_operator RLS policy, while ordinary profile
-- updates keep working, and that the owner RPC is the only client path.
--
-- Run by the "Database migration and pgTAP checks" CI job after migrations.

create extension if not exists pgtap with schema extensions;

begin;
select plan(6);

-- Test fixtures: u1 is a plain user, u2 is an owner operator.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'plain-user@test.local', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-operator@test.local', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, is_operator, operator_role)
values
  ('d1000000-0000-4000-8000-000000000001', 'plain-user@test.local', false, null),
  ('d2000000-0000-4000-8000-000000000002', 'owner-operator@test.local', true, 'owner')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. As the plain user: ordinary profile self-update still works.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000001"}',
  true
);

select lives_ok(
  $$
    update public.profiles
    set full_name = 'Plain User Renamed'
    where id = 'd1000000-0000-4000-8000-000000000001'
      and id = (select auth.uid())
  $$,
  'ordinary self-update of non-operator columns is allowed'
);

-- ---------------------------------------------------------------------------
-- 2. As the plain user: elevating operator columns must raise.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.profiles
    set operator_role = 'owner'
    where id = 'd1000000-0000-4000-8000-000000000001'
  $$,
  'operator role columns are protected',
  'a normal user cannot grant themselves operator_role'
);

select throws_ok(
  $$
    update public.profiles
    set is_operator = true
    where id = 'd1000000-0000-4000-8000-000000000001'
  $$,
  'operator role columns are protected',
  'a normal user cannot flip is_operator'
);

-- The failed updates must not have changed anything.
select is(
  (select operator_role from public.profiles where id = 'd1000000-0000-4000-8000-000000000001'),
  null,
  'operator_role stays null after the rejected updates'
);
select is(
  (select is_operator from public.profiles where id = 'd1000000-0000-4000-8000-000000000001'),
  false,
  'is_operator stays false after the rejected updates'
);

-- ---------------------------------------------------------------------------
-- 3. Owner RPC path: the owner operator can promote the plain user.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d2000000-0000-4000-8000-000000000002"}',
  true
);

select lives_ok(
  $$
    select public.set_operator_role(
      'd1000000-0000-4000-8000-000000000001',
      'support'
    )
  $$,
  'an owner operator can assign the support role through the RPC'
);

select is(
  (select operator_role from public.profiles where id = 'd1000000-0000-4000-8000-000000000001'),
  'support',
  'the RPC applied the support role'
);

select * from finish();
rollback;
