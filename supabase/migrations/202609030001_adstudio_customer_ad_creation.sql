-- Explicit customer-ad creation and library metadata.
-- Additive only: existing ads remain addressable and are not rewritten or removed.
alter table if exists public.ad_customer_ads
  add column if not exists name text not null default 'Untitled ad',
  add column if not exists status text not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists creation_key text;

do $$ begin
  if to_regclass('public.ad_customer_ads') is not null
     and not exists (select 1 from pg_constraint where conname = 'ad_customer_ads_status_check') then
    alter table public.ad_customer_ads add constraint ad_customer_ads_status_check
      check (status in ('draft', 'published', 'archived'));
  end if;
end $$;

-- A request key is scoped to a workspace. It prevents retries/double submits
-- from creating duplicate rows while leaving intentional creates independent.
create unique index if not exists ad_customer_ads_workspace_creation_key_idx
  on public.ad_customer_ads(workspace_id, creation_key)
  where creation_key is not null;
create index if not exists ad_customer_ads_workspace_updated_idx
  on public.ad_customer_ads(workspace_id, updated_at desc, id desc);
