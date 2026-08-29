-- Sole direct-template schema. This is the expand phase of the cutover:
-- legacy pack columns and rows are retained, while all new customer ads and
-- artifacts use the direct template ID. Exact legacy removal is post-canary.
begin;

do $$
begin
  if to_regclass('public.ad_templates') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'ad_templates' and column_name = 'id'
     ) then
    if to_regclass('public.ad_templates_retired') is not null then
      raise exception 'cannot retire legacy ad_templates: ad_templates_retired already exists';
    end if;
    alter table public.ad_templates rename to ad_templates_retired;
  end if;
end $$;

create table if not exists public.ad_templates (
  template_id text primary key,
  template_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_template_assets_direct (
  id uuid primary key default gen_random_uuid(),
  template_id text not null references public.ad_templates(template_id) on delete restrict,
  asset_key text not null,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  unique (template_id, asset_key)
);

create index if not exists ad_template_assets_direct_template_idx
  on public.ad_template_assets_direct(template_id);

-- Retain the legacy provenance columns for existing rows, but stop requiring
-- them for direct-template customer ads. NOT VALID preserves any historical
-- rows that predate the direct catalog while enforcing the FK for new writes.
alter table if exists public.ad_customer_ads
  drop constraint if exists ad_customer_ads_template_pack_id_fkey;
alter table if exists public.ad_customer_ads
  alter column template_pack_id drop not null;
alter table if exists public.ad_customer_ads
  alter column template_version drop not null;

do $$
begin
  if to_regclass('public.ad_customer_ads') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.ad_customer_ads'::regclass
         and conname = 'ad_customer_ads_template_id_direct_fkey'
     ) then
    alter table public.ad_customer_ads
      add constraint ad_customer_ads_template_id_direct_fkey
      foreign key (template_id)
      references public.ad_templates(template_id)
      on delete restrict
      not valid;
  end if;
end $$;

create index if not exists idx_customer_ads_workspace_template
  on public.ad_customer_ads(workspace_id, template_id);

create or replace function public.finalize_ad_template_artifact(
  p_template_id text,
  p_template_json jsonb,
  p_assets jsonb
)
returns table(template_id text, replayed boolean, asset_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_template jsonb;
  template_exists boolean;
  incoming_count integer;
  incoming_distinct_count integer;
begin
  if p_template_id is null or btrim(p_template_id) = ''
     or jsonb_typeof(p_template_json) <> 'object'
     or p_template_json ->> 'schema' <> 'blockwise.ad-template'
     or p_template_json ->> 'templateId' <> p_template_id
     or jsonb_typeof(p_assets) <> 'array' then
    raise exception 'template_artifact_invalid' using errcode = 'P0001';
  end if;

  select count(*)::integer, count(distinct asset_key)::integer
    into incoming_count, incoming_distinct_count
  from jsonb_to_recordset(p_assets)
    as incoming(asset_key text, file_name text, mime_type text, storage_path text);

  if incoming_count <> incoming_distinct_count
     or exists (
       select 1
       from jsonb_to_recordset(p_assets)
         as incoming(asset_key text, file_name text, mime_type text, storage_path text)
       where incoming.asset_key is null or btrim(incoming.asset_key) = ''
          or incoming.file_name is null or btrim(incoming.file_name) = ''
          or incoming.mime_type is null or btrim(incoming.mime_type) = ''
          or incoming.storage_path is null or btrim(incoming.storage_path) = ''
     ) then
    raise exception 'template_artifact_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 2026083002));

  select direct_template.template_json
    into current_template
  from public.ad_templates as direct_template
  where direct_template.template_id = p_template_id
  for update;
  template_exists := found;

  if template_exists then
    if current_template <> p_template_json then
      raise exception 'template_artifact_conflict' using errcode = 'P0001';
    end if;

    if exists (
      select stored.asset_key, stored.file_name, stored.mime_type, stored.storage_path
      from public.ad_template_assets_direct as stored
      where stored.template_id = p_template_id
      except
      select incoming.asset_key, incoming.file_name, incoming.mime_type, incoming.storage_path
      from jsonb_to_recordset(p_assets)
        as incoming(asset_key text, file_name text, mime_type text, storage_path text)
    ) or exists (
      select incoming.asset_key, incoming.file_name, incoming.mime_type, incoming.storage_path
      from jsonb_to_recordset(p_assets)
        as incoming(asset_key text, file_name text, mime_type text, storage_path text)
      except
      select stored.asset_key, stored.file_name, stored.mime_type, stored.storage_path
      from public.ad_template_assets_direct as stored
      where stored.template_id = p_template_id
    ) then
      raise exception 'template_artifact_asset_conflict' using errcode = 'P0001';
    end if;

    replayed := true;
  else
    insert into public.ad_templates(template_id, template_json)
    values (p_template_id, p_template_json);

    insert into public.ad_template_assets_direct(
      template_id,
      asset_key,
      file_name,
      mime_type,
      storage_path
    )
    select
      p_template_id,
      incoming.asset_key,
      incoming.file_name,
      incoming.mime_type,
      incoming.storage_path
    from jsonb_to_recordset(p_assets)
      as incoming(asset_key text, file_name text, mime_type text, storage_path text);

    replayed := false;
  end if;

  select count(*)::integer
    into asset_count
  from public.ad_template_assets_direct as stored
  where stored.template_id = p_template_id;

  if asset_count <> incoming_count then
    raise exception 'template_artifact_asset_set_incomplete' using errcode = 'P0001';
  end if;

  template_id := p_template_id;
  return next;
end $$;

revoke all on function public.finalize_ad_template_artifact(text, jsonb, jsonb) from public;
grant execute on function public.finalize_ad_template_artifact(text, jsonb, jsonb) to service_role;

alter table public.ad_templates enable row level security;
alter table public.ad_template_assets_direct enable row level security;

drop policy if exists ad_templates_authenticated_select on public.ad_templates;
create policy ad_templates_authenticated_select on public.ad_templates
  for select to authenticated using (true);

drop policy if exists ad_template_assets_direct_authenticated_select on public.ad_template_assets_direct;
create policy ad_template_assets_direct_authenticated_select on public.ad_template_assets_direct
  for select to authenticated using (true);

grant select on public.ad_templates, public.ad_template_assets_direct to authenticated;
grant all on public.ad_templates, public.ad_template_assets_direct to service_role;

commit;
