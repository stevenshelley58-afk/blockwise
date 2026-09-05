create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

-- Committed fixtures let two dblink sessions exercise the real row lock.
delete from research.provider_credit_attempts where provider='ledger-concurrency';
delete from research.provider_credit_budgets where provider='ledger-concurrency';
insert into research.provider_credit_budgets(provider,period_start,max_credits)
values('ledger-concurrency',date '2099-01-01',100);
create or replace function research._test_try_reserve_provider_attempt(p_attempt_id uuid,p_run_id uuid)
returns boolean language plpgsql as $$
begin
  perform research.reserve_provider_attempt_credits(
    p_attempt_id,'ledger-concurrency',p_run_id,10,10,100,clock_timestamp());
  return true;
exception when others then
  if sqlerrm like 'provider_credit_run_cap_exhausted:%' then return false; end if;
  raise;
end $$;

begin;
select plan(15);
insert into research.provider_credit_budgets(provider,period_start,max_credits)
values('ledger-basic',date '2099-01-01',100);

select is((research.reserve_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000001','ledger-basic',
  '20000000-0000-4000-8000-000000000001',25,50,100,clock_timestamp()
)->>'idempotent')::boolean,false,'first reserve creates a durable attempt');
select is((research.reserve_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000001','ledger-basic',
  '20000000-0000-4000-8000-000000000001',25,50,100,
  (select provider_balance_verified_at from research.provider_credit_attempts
   where attempt_id='10000000-0000-4000-8000-000000000001')
)->>'idempotent')::boolean,true,'repeat reserve is idempotent');
select is((select reserved_credits from research.provider_credit_budgets where provider='ledger-basic'),
  25::numeric,'repeat reserve does not double-hold');

select is((research.settle_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000001','blocked',true,7
)->>'actual_credits')::numeric,7::numeric,'paid failure records actual charge');
select is((research.settle_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000001','blocked',true,7
)->>'idempotent')::boolean,true,'repeat settlement is idempotent');
select is((select spent_credits from research.provider_credit_budgets where provider='ledger-basic'),
  7::numeric,'repeat settlement does not double-spend');
select throws_ok(
  $$select research.settle_provider_attempt_credits(
    '10000000-0000-4000-8000-000000000001','blocked',true,8)$$,
  'P0001','provider_credit_settlement_conflict: 10000000-0000-4000-8000-000000000001',
  'conflicting settlement is rejected');

select research.reserve_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000002','ledger-basic',
  '20000000-0000-4000-8000-000000000002',25,50,75,clock_timestamp());
select is((research.settle_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000002','transport_unknown',false,null
)->>'actual_credits')::numeric,25::numeric,'unknown charge consumes the full hold');
select is((select spent_credits from research.provider_credit_budgets where provider='ledger-basic'),
  32::numeric,'unknown charge is never refunded');

select research.reserve_provider_attempt_credits(
  '10000000-0000-4000-8000-000000000003','ledger-basic',
  '20000000-0000-4000-8000-000000000003',10,10,43,clock_timestamp());
select throws_ok(
  $$select research.reserve_provider_attempt_credits(
    '10000000-0000-4000-8000-000000000004','ledger-basic',
    '20000000-0000-4000-8000-000000000003',1,10,43,
    (select provider_balance_verified_at from research.provider_credit_budgets where provider='ledger-basic'))$$,
  'P0001','provider_credit_run_cap_exhausted: run 20000000-0000-4000-8000-000000000003',
  'run cap is atomic');
select throws_ok(
  $$select research.reserve_provider_attempt_credits(
    '10000000-0000-4000-8000-000000000005','ledger-basic',
    '20000000-0000-4000-8000-000000000005',34,40,43,
    (select provider_balance_verified_at from research.provider_credit_budgets where provider='ledger-basic'))$$,
  'P0001','provider_credit_account_balance_exhausted: provider ledger-basic',
  'authenticated account balance is an independent cap');

select extensions.dblink_connect('credit_cap_1','host=127.0.0.1'||
  ' port=5432 dbname='||current_database()||' user='||current_user||' password='||current_user);
select extensions.dblink_connect('credit_cap_2','host=127.0.0.1'||
  ' port=5432 dbname='||current_database()||' user='||current_user||' password='||current_user);
select ok(extensions.dblink_send_query('credit_cap_1',
  $$select research._test_try_reserve_provider_attempt(
    '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001')$$)=1,
  'first concurrent reserve sent');
select ok(extensions.dblink_send_query('credit_cap_2',
  $$select research._test_try_reserve_provider_attempt(
    '30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001')$$)=1,
  'second concurrent reserve sent');
select isnt(
  (select reserved from extensions.dblink_get_result('credit_cap_1') as x(reserved boolean)),
  (select reserved from extensions.dblink_get_result('credit_cap_2') as x(reserved boolean)),
  'concurrent run-cap reservations have exactly one winner');
select is((select reserved_credits from research.provider_credit_budgets where provider='ledger-concurrency'),
  10::numeric,'concurrent reserves never overshoot the cap');

select * from finish();
rollback;
select extensions.dblink_disconnect('credit_cap_1');
select extensions.dblink_disconnect('credit_cap_2');
delete from research.provider_credit_attempts where provider='ledger-concurrency';
delete from research.provider_credit_budgets where provider='ledger-concurrency';
drop function research._test_try_reserve_provider_attempt(uuid,uuid);
