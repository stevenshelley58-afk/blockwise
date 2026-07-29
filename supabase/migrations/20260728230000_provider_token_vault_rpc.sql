-- 20260728094700_reset_postgrest_exposed_schemas.sql stopped exposing the
-- private schema through PostgREST, which cut off every
-- .schema("private").from("provider_token_vault") call in the app: token
-- reads returned nothing (health "missing_token", Meta asset dropdowns
-- degraded to plain inputs) and token writes threw after the connection row
-- was already saved.
--
-- Keep the private schema unexposed and give service-role server code a
-- narrow RPC surface into the vault instead. The functions are security
-- definer, default PUBLIC execute is revoked, and only service_role may call
-- them, so anon/authenticated clients still cannot reach the vault.

create or replace function public.provider_token_vault_get(p_provider_connection_id uuid)
returns table (
  encrypted_access_token bytea,
  encrypted_refresh_token bytea,
  token_nonce text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.encrypted_access_token,
    v.encrypted_refresh_token,
    v.token_nonce
  from private.provider_token_vault as v
  where v.provider_connection_id = p_provider_connection_id;
$$;

create or replace function public.provider_token_vault_upsert(
  p_provider_connection_id uuid,
  p_workspace_id uuid,
  p_encrypted_access_token bytea,
  p_encrypted_refresh_token bytea,
  p_token_nonce text,
  p_token_last_four text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.provider_token_vault (
    provider_connection_id,
    workspace_id,
    encrypted_access_token,
    encrypted_refresh_token,
    token_nonce,
    token_last_four,
    updated_at
  )
  values (
    p_provider_connection_id,
    p_workspace_id,
    p_encrypted_access_token,
    p_encrypted_refresh_token,
    p_token_nonce,
    p_token_last_four,
    now()
  )
  on conflict (provider_connection_id) do update set
    workspace_id = excluded.workspace_id,
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    token_nonce = excluded.token_nonce,
    token_last_four = excluded.token_last_four,
    updated_at = excluded.updated_at;
$$;

create or replace function public.provider_token_vault_clear(p_provider_connection_id uuid)
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
  where provider_connection_id = p_provider_connection_id;
$$;

revoke all on function public.provider_token_vault_get(uuid) from public, anon, authenticated;
revoke all on function public.provider_token_vault_upsert(uuid, uuid, bytea, bytea, text, text) from public, anon, authenticated;
revoke all on function public.provider_token_vault_clear(uuid) from public, anon, authenticated;

grant execute on function public.provider_token_vault_get(uuid) to service_role;
grant execute on function public.provider_token_vault_upsert(uuid, uuid, bytea, bytea, text, text) to service_role;
grant execute on function public.provider_token_vault_clear(uuid) to service_role;

notify pgrst, 'reload schema';
