-- Meta Data Deletion Callback persistence.
--
-- Meta posts a signed_request to /api/integrations/meta/data-deletion whenever
-- a Facebook user revokes Blockwise's access. We persist the request keyed by
-- the Meta-scoped user_id so an asynchronous worker can complete the deletion
-- (clearing tokens, lead submissions, etc.) on a 30-day SLA.
--
-- This table is intentionally write-only from the public-facing callback. Only
-- the service role and an internal worker should ever read it.

create table if not exists public.meta_data_deletion_requests (
  meta_user_id text primary key,
  confirmation_code text not null,
  status text not null default 'queued'
    check (status in ('queued', 'in_progress', 'completed', 'failed')),
  signed_request_payload jsonb not null default '{}',
  issued_at timestamptz not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

create index if not exists meta_data_deletion_requests_status_idx
  on public.meta_data_deletion_requests (status);

alter table public.meta_data_deletion_requests enable row level security;

-- No anonymous or authenticated user should ever see this table. Only the
-- service role can read or write.
revoke all on public.meta_data_deletion_requests from anon, authenticated;

comment on table public.meta_data_deletion_requests is
  'Meta App Review compliance: tracks Data Deletion Callback requests.';
comment on column public.meta_data_deletion_requests.confirmation_code is
  'Returned to Meta and surfaced at /data-deletion?code= for status lookup.';
