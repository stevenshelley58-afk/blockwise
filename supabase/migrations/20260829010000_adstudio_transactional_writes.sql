-- Ad Studio transactional writes and tenant isolation.
-- PostgreSQL is the OSS transaction boundary for both the signed pack import
-- and customer revision save paths; PostgREST clients call these functions as
-- one database transaction instead of coordinating related table writes.

begin;

-- Global, source-free template metadata is readable by signed-in customers.
-- Only the service role may mutate the import ledger or immutable pack rows.
alter table public.ad_import_receipts enable row level security;
alter table public.ad_import_nonces enable row level security;
alter table public.ad_template_packs enable row level security;
alter table public.ad_template_pack_versions enable row level security;
alter table public.ad_template_assets enable row level security;

drop policy if exists ad_import_receipts_authenticated_select on public.ad_import_receipts;
create policy ad_import_receipts_authenticated_select
  on public.ad_import_receipts for select to authenticated using (true);

drop policy if exists ad_template_packs_authenticated_select on public.ad_template_packs;
create policy ad_template_packs_authenticated_select
  on public.ad_template_packs for select to authenticated using (true);

drop policy if exists ad_template_pack_versions_authenticated_select on public.ad_template_pack_versions;
create policy ad_template_pack_versions_authenticated_select
  on public.ad_template_pack_versions for select to authenticated using (true);

drop policy if exists ad_template_assets_authenticated_select on public.ad_template_assets;
create policy ad_template_assets_authenticated_select
  on public.ad_template_assets for select to authenticated using (true);

-- Customer-created state is always workspace scoped. Revisions and render
-- attempts are immutable from PostgREST and are written only through the
-- transactional function below.
alter table public.ad_customer_ads enable row level security;
alter table public.ad_revisions enable row level security;
alter table public.ad_render_attempts enable row level security;
alter table public.ad_instant_form_drafts enable row level security;
alter table public.ad_publication_snapshots enable row level security;

do $policies$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'ad_customer_ads',
    'ad_revisions',
    'ad_render_attempts',
    'ad_instant_form_drafts',
    'ad_publication_snapshots'
  ] loop
    execute format('drop policy if exists adstudio_customer_select on public.%I', relation_name);
    execute format(
      'create policy adstudio_customer_select on public.%I for select to authenticated using (private.adstudio_has_workspace_access(workspace_id))',
      relation_name
    );
  end loop;
end;
$policies$;

drop policy if exists adstudio_customer_insert on public.ad_customer_ads;
create policy adstudio_customer_insert
  on public.ad_customer_ads for insert to authenticated
  with check (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists adstudio_customer_update on public.ad_customer_ads;
create policy adstudio_customer_update
  on public.ad_customer_ads for update to authenticated
  using (private.adstudio_has_workspace_access(workspace_id))
  with check (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists adstudio_form_insert on public.ad_instant_form_drafts;
create policy adstudio_form_insert
  on public.ad_instant_form_drafts for insert to authenticated
  with check (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists adstudio_form_update on public.ad_instant_form_drafts;
create policy adstudio_form_update
  on public.ad_instant_form_drafts for update to authenticated
  using (private.adstudio_has_workspace_access(workspace_id))
  with check (private.adstudio_has_workspace_access(workspace_id));

drop policy if exists adstudio_snapshot_insert on public.ad_publication_snapshots;
create policy adstudio_snapshot_insert
  on public.ad_publication_snapshots for insert to authenticated
  with check (private.adstudio_has_workspace_access(workspace_id));

create or replace function public.activate_ad_template_pack_import(
  p_receipt jsonb,
  p_pack jsonb,
  p_assets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pack_id text := nullif(p_receipt ->> 'pack_id', '');
  v_pack_sha256 text := nullif(p_receipt ->> 'pack_sha256', '');
  v_existing public.ad_import_receipts%rowtype;
  v_receipt public.ad_import_receipts%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if v_pack_id is null or v_pack_sha256 is null then
    raise exception using errcode = '22023', message = 'invalid_import_envelope';
  end if;
  if p_pack ->> 'pack_id' is distinct from v_pack_id
     or p_pack ->> 'schema_version' is distinct from 'blockwise.template-pack/v2' then
    raise exception using errcode = '22023', message = 'invalid_pack_envelope';
  end if;
  if jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_asset_envelope';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pack_id, 0));
  select * into v_existing
  from public.ad_import_receipts
  where pack_id = v_pack_id;

  if found then
    if v_existing.pack_sha256 <> v_pack_sha256 then
      raise exception using errcode = 'P0001', message = 'pack_id_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'id', v_existing.id,
      'pack_id', v_existing.pack_id,
      'pack_sha256', v_existing.pack_sha256,
      'created_at', v_existing.created_at,
      'replayed', true
    );
  end if;

  if exists (select 1 from public.ad_import_nonces where nonce = p_receipt ->> 'nonce') then
    raise exception using errcode = 'P0001', message = 'nonce_replay';
  end if;
  insert into public.ad_import_nonces (nonce) values (p_receipt ->> 'nonce');

  insert into public.ad_template_packs (
    pack_id, template_id, version, schema_version, manifest_sha256, signature, pack_json
  ) values (
    v_pack_id,
    p_pack ->> 'template_id',
    (p_pack ->> 'version')::integer,
    p_pack ->> 'schema_version',
    p_pack ->> 'manifest_sha256',
    p_pack ->> 'signature',
    p_pack -> 'pack_json'
  );

  insert into public.ad_template_pack_versions (
    pack_id, version, manifest_sha256, pack_json
  ) values (
    v_pack_id,
    (p_pack ->> 'version')::integer,
    p_pack ->> 'manifest_sha256',
    p_pack -> 'pack_json'
  );

  insert into public.ad_template_assets (
    pack_id, asset_key, file_name, sha256, mime_type, storage_path
  )
  select
    v_pack_id,
    asset ->> 'asset_key',
    asset ->> 'file_name',
    asset ->> 'sha256',
    asset ->> 'mime_type',
    nullif(asset ->> 'storage_path', '')
  from pg_catalog.jsonb_array_elements(p_assets) as asset;

  insert into public.ad_import_receipts (
    pack_id, pack_sha256, build_id, issuer, issued_at, nonce, signature, status, receipt
  ) values (
    v_pack_id,
    v_pack_sha256,
    p_receipt ->> 'build_id',
    p_receipt ->> 'issuer',
    (p_receipt ->> 'issued_at')::timestamptz,
    p_receipt ->> 'nonce',
    p_receipt ->> 'signature',
    'active',
    p_receipt -> 'receipt'
  ) returning * into v_receipt;

  return pg_catalog.jsonb_build_object(
    'id', v_receipt.id,
    'pack_id', v_receipt.pack_id,
    'pack_sha256', v_receipt.pack_sha256,
    'created_at', v_receipt.created_at,
    'replayed', false
  );
end;
$function$;

revoke all on function public.activate_ad_template_pack_import(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.activate_ad_template_pack_import(jsonb, jsonb, jsonb) to service_role;

create or replace function public.commit_ad_revision(
  p_ad_id uuid,
  p_workspace_id uuid,
  p_expected_active_revision_id uuid,
  p_revision jsonb,
  p_attempts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_revision_id uuid;
  v_revision public.ad_revisions%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and not private.adstudio_has_workspace_access(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if jsonb_typeof(p_attempts) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_render_attempts';
  end if;

  select active_revision_id into v_active_revision_id
  from public.ad_customer_ads
  where id = p_ad_id and workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ad_not_found';
  end if;
  if v_active_revision_id is distinct from p_expected_active_revision_id then
    raise exception using errcode = '40001', message = 'stale_revision';
  end if;

  insert into public.ad_revisions (
    ad_id, workspace_id, revision_number, document_json, document_hash,
    feed_png_hash, feed_png_path, story_png_hash, story_png_path,
    template_hash, renderer_version
  ) values (
    p_ad_id,
    p_workspace_id,
    (p_revision ->> 'revision_number')::integer,
    p_revision -> 'document_json',
    p_revision ->> 'document_hash',
    p_revision ->> 'feed_png_hash',
    p_revision ->> 'feed_png_path',
    p_revision ->> 'story_png_hash',
    p_revision ->> 'story_png_path',
    p_revision ->> 'template_hash',
    p_revision ->> 'renderer_version'
  ) returning * into v_revision;

  insert into public.ad_render_attempts (
    revision_id, workspace_id, placement, png_hash, png_path, renderer_version, duration_ms
  )
  select
    v_revision.id,
    p_workspace_id,
    attempt ->> 'placement',
    attempt ->> 'png_hash',
    nullif(attempt ->> 'png_path', ''),
    attempt ->> 'renderer_version',
    nullif(attempt ->> 'duration_ms', '')::integer
  from pg_catalog.jsonb_array_elements(p_attempts) as attempt;

  update public.ad_customer_ads
  set active_revision_id = v_revision.id, updated_at = pg_catalog.now()
  where id = p_ad_id and workspace_id = p_workspace_id;

  return pg_catalog.jsonb_build_object(
    'id', v_revision.id,
    'revision_number', v_revision.revision_number
  );
end;
$function$;

revoke all on function public.commit_ad_revision(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.commit_ad_revision(uuid, uuid, uuid, jsonb, jsonb) to authenticated, service_role;

commit;
