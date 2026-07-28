create extension if not exists pgtap with schema extensions;

begin;

select plan(8);

insert into public.workspaces (id, name)
values ('e1000000-0000-4000-8000-000000000001', 'Credit RPC Test');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'f1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'credit-rpc@example.test', '',
  '{}'::jsonb, '{}'::jsonb, now(), now(), now()
);

insert into public.profiles (id, email)
values ('f1000000-0000-4000-8000-000000000001', 'credit-rpc@example.test');

select *
from public.grant_workspace_credits(
  'e1000000-0000-4000-8000-000000000001',
  'operator',
  'credit-rpc-test-period',
  10,
  now(),
  now() + interval '1 day',
  'credit-rpc-test-grant',
  'pgtap',
  '{}'::jsonb
);

create temp table credit_test_reservation as
select *
from public.reserve_workspace_credits(
  'e1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  2,
  'credit-rpc-test-reserve',
  'adstudio.feed_story_pack',
  '{}'::jsonb
);

select ok(
  (select allowed from credit_test_reservation),
  'reservation succeeds without a PL/pgSQL column ambiguity'
);

select is(
  (select credits_reserved from credit_test_reservation),
  2,
  'reservation returns the reserved quantity'
);

select is(
  (
    select credits_reserved
    from public.workspace_credit_wallets
    where workspace_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  2,
  'reservation updates the active wallet'
);

create temp table credit_test_settlement as
select *
from public.settle_workspace_credit_reservation(
  'e1000000-0000-4000-8000-000000000001',
  (select reservation_id from credit_test_reservation),
  1,
  'credit-rpc-test-settle',
  '{}'::jsonb
);

select is(
  (select credits_settled from credit_test_settlement),
  1,
  'settlement succeeds without a PL/pgSQL column ambiguity'
);

select is(
  (
    select credits_reserved
    from public.workspace_credit_wallets
    where workspace_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  1,
  'settlement releases one reserved credit'
);

select is(
  (
    select credits_consumed
    from public.workspace_credit_wallets
    where workspace_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  1,
  'settlement consumes one credit'
);

create temp table credit_test_refund as
select *
from public.refund_workspace_credit_reservation(
  'e1000000-0000-4000-8000-000000000001',
  (select reservation_id from credit_test_reservation),
  1,
  'credit-rpc-test-refund',
  'story_render_failed',
  '{}'::jsonb
);

select is(
  (select credits_refunded from credit_test_refund),
  1,
  'refund succeeds without a PL/pgSQL column ambiguity'
);

select is(
  (
    select jsonb_build_object(
      'reserved', credits_reserved,
      'consumed', credits_consumed,
      'remaining', credits_granted - credits_reserved - credits_consumed - credits_expired
    )
    from public.workspace_credit_wallets
    where workspace_id = 'e1000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  '{"reserved": 0, "consumed": 1, "remaining": 9}'::jsonb,
  'the full reserve-settle-refund cycle preserves the wallet balance'
);

select * from finish();

rollback;
