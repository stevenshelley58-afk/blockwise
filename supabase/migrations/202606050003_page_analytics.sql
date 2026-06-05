-- Page analytics: first-party page-view events powering the operator
-- console "Site Analytics" dashboard (/operator/analytics).
--
-- Additive and idempotent. Safe to run on an existing production database:
-- it only ADDs one new server-owned table + indexes and changes no existing
-- data, RLS, or API behaviour.
--
-- Privacy: rows carry no PII and no raw IPs. visitor_hash is a salted,
-- day-scoped hash computed in /api/track, so visitors cannot be tracked
-- across days and hashes cannot be reversed to an IP.

create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  path text not null,
  referrer text,
  visitor_hash text not null,
  device text,
  country text
);

create index if not exists page_views_occurred_at_idx
  on public.page_views (occurred_at desc);
create index if not exists page_views_path_idx
  on public.page_views (path, occurred_at desc);

alter table public.page_views enable row level security;

-- Server-owned: RLS is enabled with NO policies on purpose. Only the
-- service-role key (used by /api/track and /api/operator/analytics) can
-- read or write; anon and authenticated clients have no access at all.

comment on table public.page_views is
  'First-party page-view events captured by POST /api/track. Service-role access only; surfaced via /api/operator/analytics.';
comment on column public.page_views.visitor_hash is
  'sha256(salt:utc-day:ip:user-agent) truncated to 32 chars. Day-scoped, salted, irreversible; never store raw IPs.';
comment on column public.page_views.referrer is
  'External referrer hostname only (e.g. google.com). Same-site referrers are stored as null.';
