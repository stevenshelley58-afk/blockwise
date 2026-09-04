-- Customer visibility is a fail-closed, service-only transition. The direct
-- artifact is immutable; activation binds it to the corrected Hermes run and
-- also confirms that its complete declared asset set was finalized.

alter table public.ad_templates
  drop constraint if exists ad_templates_active_review_check;

alter table public.ad_templates
  add constraint ad_templates_active_review_check
  check (
    library_status = 'quarantined'
    or (
      library_review_run_id is not null
      and btrim(library_review_run_id) <> ''
      and library_reviewed_at is not null
    )
  );

create or replace function public.activate_reviewed_ad_template(
  p_template_id text,
  p_review_run_id text
)
returns table(template_id text, library_status text, review_run_id text, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_template jsonb;
  activated_at timestamptz := statement_timestamp();
begin
  if p_template_id is null or btrim(p_template_id) = ''
     or p_review_run_id is null
     or p_review_run_id !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'reviewed_template_activation_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 2026090401));

  select direct_template.template_json
    into current_template
  from public.ad_templates as direct_template
  where direct_template.template_id = p_template_id
  for update;

  if not found then
    raise exception 'reviewed_template_not_found' using errcode = 'P0001';
  end if;

  if current_template ->> 'schema' <> 'blockwise.ad-template'
     or current_template ->> 'templateId' <> p_template_id
     or jsonb_typeof(current_template -> 'assets') <> 'object' then
    raise exception 'reviewed_template_invalid' using errcode = 'P0001';
  end if;

  if exists (
    select declared.asset_key
    from jsonb_object_keys(current_template -> 'assets') as declared(asset_key)
    except
    select stored.asset_key
    from public.ad_template_assets_direct as stored
    where stored.template_id = p_template_id
  ) or exists (
    select stored.asset_key
    from public.ad_template_assets_direct as stored
    where stored.template_id = p_template_id
    except
    select declared.asset_key
    from jsonb_object_keys(current_template -> 'assets') as declared(asset_key)
  ) then
    raise exception 'reviewed_template_assets_incomplete' using errcode = 'P0001';
  end if;

  update public.ad_templates as direct_template
  set
    library_status = 'active',
    library_review_run_id = p_review_run_id,
    library_reviewed_at = activated_at
  where direct_template.template_id = p_template_id;

  template_id := p_template_id;
  library_status := 'active';
  review_run_id := p_review_run_id;
  reviewed_at := activated_at;
  return next;
end $$;

create or replace function public.quarantine_ad_template(
  p_template_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_template_id is null or btrim(p_template_id) = '' then
    raise exception 'template_quarantine_invalid' using errcode = 'P0001';
  end if;

  update public.ad_templates as direct_template
  set
    library_status = 'quarantined',
    library_review_run_id = null,
    library_reviewed_at = null
  where direct_template.template_id = p_template_id;

  if not found then
    raise exception 'template_quarantine_not_found' using errcode = 'P0001';
  end if;

  return p_template_id;
end $$;

revoke all on function public.activate_reviewed_ad_template(text, text) from public, anon, authenticated;
revoke all on function public.quarantine_ad_template(text) from public, anon, authenticated;
grant execute on function public.activate_reviewed_ad_template(text, text) to service_role;
grant execute on function public.quarantine_ad_template(text) to service_role;
