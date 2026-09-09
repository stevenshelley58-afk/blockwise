create table if not exists private.blockwise_internal_request_nonces (
  scope text not null,
  nonce text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint blockwise_internal_request_nonces_pkey primary key (scope, nonce),
  constraint blockwise_internal_request_nonces_scope_check
    check (scope = 'adstudio.templates'),
  constraint blockwise_internal_request_nonces_nonce_check
    check (nonce ~ '^[a-f0-9]{32}$')
);

revoke all on table private.blockwise_internal_request_nonces from public, anon, authenticated, service_role;

create or replace function public.claim_blockwise_internal_request_nonce(
  p_scope text,
  p_nonce text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  inserted_count integer;
begin
  if p_scope <> 'adstudio.templates'
    or p_nonce !~ '^[a-f0-9]{32}$'
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '10 minutes'
  then
    raise exception 'invalid_internal_request_nonce';
  end if;

  delete from private.blockwise_internal_request_nonces
  where expires_at <= statement_timestamp();

  insert into private.blockwise_internal_request_nonces (scope, nonce, expires_at)
  values (p_scope, p_nonce, p_expires_at)
  on conflict (scope, nonce) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.claim_blockwise_internal_request_nonce(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_blockwise_internal_request_nonce(text, text, timestamptz)
  to service_role;

comment on function public.claim_blockwise_internal_request_nonce(text, text, timestamptz) is
  'Atomically claims a short-lived, signed internal request nonce. False means replay.';
