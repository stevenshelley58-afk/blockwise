-- Ad Studio recovery runs on the VPS, but provider credentials must remain in
-- the encrypted private vault rather than the worker environment. Extend the
-- existing vault with a service-scoped lane while preserving all connection-
-- scoped Meta/Google rows and their service-role-only RPC surface.

do $$
declare
  v_rows bigint;
  v_invalid bigint;
begin
  select count(*) into v_rows from private.provider_token_vault;
  select count(*) into v_invalid
  from private.provider_token_vault
  where provider_connection_id is null or workspace_id is null;

  if v_invalid <> 0 then
    raise exception 'provider_token_vault has % invalid connection-scoped rows out of %; refusing scope migration', v_invalid, v_rows;
  end if;
end;
$$;

alter table private.provider_token_vault
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists runtime_provider text;

update private.provider_token_vault
set id = gen_random_uuid()
where id is null;

alter table private.provider_token_vault
  alter column id set not null,
  alter column provider_connection_id drop not null,
  alter column workspace_id drop not null;

alter table private.provider_token_vault
  drop constraint if exists provider_token_vault_pkey;

alter table private.provider_token_vault
  add constraint provider_token_vault_pkey primary key (id),
  add constraint provider_token_vault_scope_check check (
    (
      provider_connection_id is not null
      and workspace_id is not null
      and runtime_provider is null
    )
    or
    (
      provider_connection_id is null
      and workspace_id is null
      and runtime_provider = 'openai'
    )
  );

create unique index if not exists provider_token_vault_connection_uidx
  on private.provider_token_vault (provider_connection_id)
  where provider_connection_id is not null;

create unique index if not exists provider_token_vault_runtime_provider_uidx
  on private.provider_token_vault (runtime_provider)
  where runtime_provider is not null;

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
  on conflict (provider_connection_id) where provider_connection_id is not null do update set
    workspace_id = excluded.workspace_id,
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    token_nonce = excluded.token_nonce,
    token_last_four = excluded.token_last_four,
    updated_at = excluded.updated_at;
$$;

create or replace function public.runtime_provider_token_vault_get(p_runtime_provider text)
returns table (
  encrypted_access_token bytea,
  token_nonce text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.encrypted_access_token,
    v.token_nonce
  from private.provider_token_vault as v
  where v.runtime_provider = p_runtime_provider
    and p_runtime_provider = 'openai';
$$;

create or replace function public.runtime_provider_token_vault_upsert(
  p_runtime_provider text,
  p_encrypted_access_token bytea,
  p_token_nonce text,
  p_token_last_four text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_runtime_provider <> 'openai' then
    raise exception 'unsupported runtime provider';
  end if;

  insert into private.provider_token_vault (
    runtime_provider,
    encrypted_access_token,
    encrypted_refresh_token,
    token_nonce,
    token_last_four,
    updated_at
  )
  values (
    p_runtime_provider,
    p_encrypted_access_token,
    null,
    p_token_nonce,
    p_token_last_four,
    now()
  )
  on conflict (runtime_provider) where runtime_provider is not null do update set
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = null,
    token_nonce = excluded.token_nonce,
    token_last_four = excluded.token_last_four,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.runtime_provider_token_vault_clear(p_runtime_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.provider_token_vault
  set
    encrypted_access_token = null,
    token_nonce = null,
    token_last_four = null,
    updated_at = now()
  where runtime_provider = p_runtime_provider
    and p_runtime_provider = 'openai';
$$;

revoke all on function public.provider_token_vault_upsert(uuid, uuid, bytea, bytea, text, text) from public, anon, authenticated;
revoke all on function public.runtime_provider_token_vault_get(text) from public, anon, authenticated;
revoke all on function public.runtime_provider_token_vault_upsert(text, bytea, text, text) from public, anon, authenticated;
revoke all on function public.runtime_provider_token_vault_clear(text) from public, anon, authenticated;

grant execute on function public.provider_token_vault_upsert(uuid, uuid, bytea, bytea, text, text) to service_role;
grant execute on function public.runtime_provider_token_vault_get(text) to service_role;
grant execute on function public.runtime_provider_token_vault_upsert(text, bytea, text, text) to service_role;
grant execute on function public.runtime_provider_token_vault_clear(text) to service_role;

notify pgrst, 'reload schema';
