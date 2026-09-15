-- Replay repair for public.meta_publish_plans.customer_ad_id.
--
-- Production grew this column (and its FK) with the direct-customer publish flow,
-- but no migration in this directory ever created it. The historical
-- 202605280001_meta_execution_layer.sql declares the table with
-- `create table if not exists`, so against production -- which already had a
-- richer table -- that recipe was a silent no-op and the column was never
-- captured in a replayable form.
--
-- 20260912050000_index_missing_public_foreign_keys.sql indexes this column, so a
-- from-empty replay died there with `column "customer_ad_id" does not exist`.
-- This file must therefore sort BEFORE 20260912050000. The 20260911 range was
-- unused, and its only dependency, public.ad_customer_ads, is created by
-- 20260812160000_ad_customer_ads.sql.
--
-- Forward-only and idempotent: a no-op against production, which already has
-- both the column and the constraint. No column is dropped.

begin;

alter table public.meta_publish_plans
  add column if not exists customer_ad_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.meta_publish_plans'::regclass
       and conname = 'meta_publish_plans_customer_ad_id_fkey'
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_customer_ad_id_fkey
      foreign key (customer_ad_id)
      references public.ad_customer_ads (id)
      on delete cascade;
  end if;
end $$;

commit;
