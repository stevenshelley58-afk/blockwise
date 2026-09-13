-- Per-site CRM credentials, and the mapping metadata that describes them.
--
-- Before this migration every customer Frappe site was pinned to ONE shared
-- API key/secret taken from the CRM deployment .env (see
-- scripts/provision-api-user.py), so a credential read out of one agency site
-- opened every other agency site. That is the defect this migration closes.
--
-- The credential now lives in the existing encrypted vault
-- (private.provider_token_vault) as one row per workspace, and the mapping row
-- keeps only a non-secret reference: the API user, a credential version, the
-- secret's last four characters, and when it was last verified. The mapping
-- table is readable by workspace members, so no secret material is added to it.
--
-- The vault already carried two scopes: connection-scoped Meta/Google OAuth
-- rows, and service-scoped runtime provider rows (openai/google/apify). This
-- migration adds a third, workspace-scoped lane for the CRM site credential.
-- No parallel credential store is introduced.

-- ---------------------------------------------------------------------------
-- 1. Mapping metadata. Non-secret only; the table is member-readable.
-- ---------------------------------------------------------------------------

alter table public.crm_workspace_sites
  add column if not exists credential_version integer not null default 0,
  add column if not exists credential_last_four text,
  add column if not exists credential_rotated_at timestamptz,
  add column if not exists config_version integer not null default 0,
  add column if not exists site_timezone text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists failure_category text;

comment on column public.crm_workspace_sites.credential_version is
  'Increments on every rotation of this site''s CRM credential. 0 means no per-site credential has been stored yet, which is the legacy shared-credential state.';
comment on column public.crm_workspace_sites.credential_last_four is
  'Display-only tail of the current API secret, so an operator can tell two rotations apart. Never the secret.';
comment on column public.crm_workspace_sites.config_version is
  'Version of the applied native field/role configuration on the site.';
comment on column public.crm_workspace_sites.site_timezone is
  'IANA timezone the site was provisioned with, so due-date views can be computed in the workspace''s own calendar day.';
comment on column public.crm_workspace_sites.failure_category is
  'Redacted failure category for a failed provisioning attempt. Never a stack trace or a credential.';

-- `failed` is distinct from `disabled`: disabled is a deliberate operator
-- action, failed is an attempt that did not complete and must be resumed.
alter table public.crm_workspace_sites
  drop constraint if exists crm_workspace_sites_status_check;

alter table public.crm_workspace_sites
  add constraint crm_workspace_sites_status_check
  check (status in ('provisioning', 'ready', 'failed', 'disabled'));

-- A failed or provisioning site is retried, so it must be findable by status
-- and age without scanning the table.
create index if not exists crm_workspace_sites_status_idx
  on public.crm_workspace_sites (status, updated_at desc);

-- ---------------------------------------------------------------------------
-- 2. Vault lane for the workspace-scoped CRM site credential.
-- ---------------------------------------------------------------------------

-- Fail loudly rather than silently re-scoping rows we do not understand.
do $$
declare
  v_rows bigint;
  v_unknown bigint;
begin
  select count(*) into v_rows from private.provider_token_vault;

  select count(*) into v_unknown
  from private.provider_token_vault
  where not (
    (provider_connection_id is not null and workspace_id is not null and runtime_provider is null)
    or (provider_connection_id is null and workspace_id is null and runtime_provider in ('openai', 'google', 'apify'))
  );

  if v_unknown <> 0 then
    raise exception 'provider_token_vault has % rows outside the known scopes out of %; refusing scope migration', v_unknown, v_rows;
  end if;
end;
$$;

alter table private.provider_token_vault
  drop constraint if exists provider_token_vault_scope_check;

alter table private.provider_token_vault
  add constraint provider_token_vault_scope_check check (
    (provider_connection_id is not null and workspace_id is not null and runtime_provider is null)
    or (provider_connection_id is null and workspace_id is null and runtime_provider in ('openai', 'google', 'apify'))
    or (provider_connection_id is null and workspace_id is not null and runtime_provider = 'blockwise_crm_site')
  );

-- One credential per workspace. Two workspaces can never share a vault row,
-- and a provisioning retry updates the existing row instead of adding one.
create unique index if not exists provider_token_vault_crm_site_uidx
  on private.provider_token_vault (workspace_id)
  where runtime_provider = 'blockwise_crm_site';

-- ---------------------------------------------------------------------------
-- 3. Service-role-only RPC surface. The private schema is not exposed through
--    PostgREST, so these functions are the only way in.
-- ---------------------------------------------------------------------------

create or replace function public.crm_site_credential_get(p_workspace_id uuid)
returns table (
  encrypted_credential bytea,
  credential_nonce text,
  credential_last_four text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.encrypted_access_token,
    v.token_nonce,
    v.token_last_four
  from private.provider_token_vault as v
  where v.runtime_provider = 'blockwise_crm_site'
    and v.workspace_id = p_workspace_id;
$$;

create or replace function public.crm_site_credential_upsert(
  p_workspace_id uuid,
  p_encrypted_credential bytea,
  p_credential_nonce text,
  p_credential_last_four text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.provider_token_vault (
    workspace_id,
    runtime_provider,
    encrypted_access_token,
    encrypted_refresh_token,
    token_nonce,
    token_last_four,
    updated_at
  )
  values (
    p_workspace_id,
    'blockwise_crm_site',
    p_encrypted_credential,
    null,
    p_credential_nonce,
    p_credential_last_four,
    now()
  )
  on conflict (workspace_id) where runtime_provider = 'blockwise_crm_site' do update set
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = null,
    token_nonce = excluded.token_nonce,
    token_last_four = excluded.token_last_four,
    updated_at = excluded.updated_at;
end;
$$;

-- Used when a workspace is retired. Clearing leaves the mapping row in place so
-- the lifecycle stays auditable; it never deletes CRM data.
create or replace function public.crm_site_credential_clear(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.provider_token_vault
  set
    encrypted_access_token = null,
    encrypted_refresh_token = null,
    token_nonce = null,
    token_last_four = null,
    updated_at = now()
  where runtime_provider = 'blockwise_crm_site'
    and workspace_id = p_workspace_id;
$$;

revoke all on function public.crm_site_credential_get(uuid) from public, anon, authenticated;
revoke all on function public.crm_site_credential_upsert(uuid, bytea, text, text) from public, anon, authenticated;
revoke all on function public.crm_site_credential_clear(uuid) from public, anon, authenticated;

grant execute on function public.crm_site_credential_get(uuid) to service_role;
grant execute on function public.crm_site_credential_upsert(uuid, bytea, text, text) to service_role;
grant execute on function public.crm_site_credential_clear(uuid) to service_role;

notify pgrst, 'reload schema';
