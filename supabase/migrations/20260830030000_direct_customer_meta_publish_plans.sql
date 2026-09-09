-- Direct customer ads and legacy Ad Studio campaigns are different parents.
-- Preserve existing campaign-linked plans while giving the sole direct-template
-- flow an explicit FK to ad_customer_ads.

alter table public.meta_publish_plans
  add column if not exists customer_ad_id uuid;

alter table public.meta_publish_plans
  alter column adstudio_campaign_id drop not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_publish_plans'::regclass
      and conname = 'meta_publish_plans_customer_ad_id_fkey'
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_customer_ad_id_fkey
      foreign key (customer_ad_id)
      references public.ad_customer_ads (id)
      on delete cascade;
  end if;
end
$migration$;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_publish_plans'::regclass
      and conname = 'meta_publish_plans_source_check'
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_source_check
      check (num_nonnulls(adstudio_campaign_id, customer_ad_id) = 1)
      not valid;
    alter table public.meta_publish_plans
      validate constraint meta_publish_plans_source_check;
  end if;
end
$migration$;

create index if not exists meta_publish_plans_customer_ad_updated_idx
  on public.meta_publish_plans (workspace_id, customer_ad_id, updated_at desc)
  where customer_ad_id is not null;
