-- Durable transactional email outbox and suppression list.
--
-- Application email (welcome, verification, booking, billing, Meta
-- connection, support acknowledgement, deletion requests) is enqueued in the
-- outbox in the same transaction as the state change it announces, then
-- delivered by a worker through a provider-neutral interface. Suppressions
-- are separate from marketing consent: they stop transactional retries after
-- hard bounces/complaints.
--
-- PII rule: payload holds template variables only — never raw message bodies,
-- credentials, or payment data. Error text is redacted before storage
-- (src/lib/redact.ts).
--
-- RLS: tables are service-role only (RLS enabled, no policies) — clients
-- never read or write mail state directly.
--
-- Rollback:
--   drop function public.claim_email_outbox_batch(integer);
--   drop table public.email_suppressions;
--   drop table public.email_outbox;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message_type text not null,
  template_id text not null,
  template_version integer not null default 1,
  recipient text not null,
  locale text not null default 'en-AU',
  timezone text not null default 'Australia/Perth',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error text
);

create index email_outbox_due_idx
  on public.email_outbox (next_attempt_at)
  where status in ('pending', 'failed');

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text not null check (reason in ('bounce', 'complaint', 'unsubscribe', 'admin')),
  source text not null,
  created_at timestamptz not null default now(),
  unique (email, reason)
);

alter table public.email_outbox enable row level security;
alter table public.email_suppressions enable row level security;

-- Atomically claim a batch for delivery: marks rows 'sending' with a lease
-- expiry and returns them in one statement (FOR UPDATE SKIP LOCKED), so
-- parallel workers can never deliver the same message twice. Rows stuck in
-- 'sending' with an EXPIRED lease (worker crash) are re-claimed by the
-- lease window predicate; live leases are skipped.
create or replace function public.claim_email_outbox_batch(p_batch_size integer)
returns setof public.email_outbox
language sql
security definer
set search_path = public
as $$
  update public.email_outbox
  set status = 'sending',
      attempts = attempts + 1,
      lease_expires_at = now() + interval '5 minutes'
  where id in (
    select id
    from public.email_outbox
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'sending' and (lease_expires_at is null or lease_expires_at <= now()))
    order by created_at
    limit greatest(1, least(coalesce(p_batch_size, 10), 100))
    for update skip locked
  )
  returning *;
$$;

revoke all on function public.claim_email_outbox_batch(integer) from public, anon;
grant execute on function public.claim_email_outbox_batch(integer) to service_role;
