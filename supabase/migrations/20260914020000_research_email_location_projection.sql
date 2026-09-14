-- Private, one-way location hint projection from Ad Radar research.
-- Raw addresses remain in the research database; this product table holds only
-- a deterministic hash that an authenticated server can derive for itself.
create table if not exists public.research_email_location_projections (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  suburb text,
  source text not null check (source = 'ad_radar_agent_contact_projection'),
  source_observed_at timestamptz not null,
  projected_at timestamptz not null default now(),
  source_revision uuid not null
);

comment on table public.research_email_location_projections is
  'Service-only hash-to-location hints projected from private Ad Radar research. No raw email, contact details, outreach eligibility, or workspace default belongs here.';

alter table public.research_email_location_projections enable row level security;
revoke all on table public.research_email_location_projections from public, anon, authenticated;
grant select, insert, update, delete on table public.research_email_location_projections to service_role;

create index if not exists research_email_location_projections_source_revision_idx
  on public.research_email_location_projections (source, source_revision);
