-- Permit Google AI Studio credentials in the same encrypted, service-scoped
-- runtime vault as OpenAI. No workspace connection can use this lane.
alter table private.provider_token_vault
  drop constraint if exists provider_token_vault_scope_check;

alter table private.provider_token_vault
  add constraint provider_token_vault_scope_check check (
    (provider_connection_id is not null and workspace_id is not null and runtime_provider is null)
    or
    (provider_connection_id is null and workspace_id is null and runtime_provider in ('openai', 'google'))
  );

create or replace function public.runtime_provider_token_vault_get(p_runtime_provider text)
returns table (encrypted_access_token bytea, token_nonce text)
language sql stable security definer set search_path = ''
as $$
  select v.encrypted_access_token, v.token_nonce
  from private.provider_token_vault as v
  where v.runtime_provider = p_runtime_provider
    and p_runtime_provider in ('openai', 'google');
$$;

create or replace function public.runtime_provider_token_vault_upsert(
  p_runtime_provider text, p_encrypted_access_token bytea, p_token_nonce text, p_token_last_four text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_runtime_provider not in ('openai', 'google') then raise exception 'unsupported runtime provider'; end if;
  insert into private.provider_token_vault (
    runtime_provider, encrypted_access_token, encrypted_refresh_token, token_nonce, token_last_four, updated_at
  ) values (p_runtime_provider, p_encrypted_access_token, null, p_token_nonce, p_token_last_four, now())
  on conflict (runtime_provider) where runtime_provider is not null do update set
    encrypted_access_token = excluded.encrypted_access_token, encrypted_refresh_token = null,
    token_nonce = excluded.token_nonce, token_last_four = excluded.token_last_four, updated_at = now();
end;
$$;

create or replace function public.runtime_provider_token_vault_clear(p_runtime_provider text)
returns void language sql security definer set search_path = ''
as $$
  update private.provider_token_vault
  set encrypted_access_token = null, token_nonce = null, token_last_four = null, updated_at = now()
  where runtime_provider = p_runtime_provider and p_runtime_provider in ('openai', 'google');
$$;

revoke all on function public.runtime_provider_token_vault_get(text) from public, anon, authenticated;
revoke all on function public.runtime_provider_token_vault_upsert(text, bytea, text, text) from public, anon, authenticated;
revoke all on function public.runtime_provider_token_vault_clear(text) from public, anon, authenticated;
grant execute on function public.runtime_provider_token_vault_get(text) to service_role;
grant execute on function public.runtime_provider_token_vault_upsert(text, bytea, text, text) to service_role;
grant execute on function public.runtime_provider_token_vault_clear(text) to service_role;
