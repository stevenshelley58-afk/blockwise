-- Internal API replay protection.
--
-- verifyInternalRequest (src/lib/internal-auth.ts) stores every accepted
-- request nonce here; a nonce can only be inserted once, so replaying a
-- captured request inside the timestamp window is rejected.
--
-- Rollback: drop table public.internal_request_nonces;
-- (Safe to roll back only after reverting the internal-auth code that
-- inserts into it.)

create table public.internal_request_nonces (
  nonce text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.internal_request_nonces is
  'Single-use nonces for internal HMAC-authenticated API requests. Rows past expires_at are garbage and deleted opportunistically.';

-- Server-only table: RLS on, no policies, so anon/authenticated roles have no
-- access; only service-role code touches it.
alter table public.internal_request_nonces enable row level security;
