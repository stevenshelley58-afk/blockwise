-- Repair production drift where area-attribution tables existed in migrations
-- but were unavailable to Hermes through the research REST schema.

create table if not exists research.agent_service_areas (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references research.agents (id) on delete cascade,
  agency_id uuid references research.agencies (id) on delete cascade,
  postcode text not null,
  suburb text not null,
  state text not null default 'WA',
  match_type text not null
    check (match_type in (
      'office_postcode',
      'listing_attribution',
      'service_suburb',
      'agent_profile_listing',
      'ad_targeting_observed',
      'manual',
      'nearby_market'
    )),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  source_document_id uuid references research.source_documents (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint agent_service_areas_subject_required
    check (agent_id is not null or agency_id is not null)
);

create index if not exists agent_service_areas_postcode_idx
  on research.agent_service_areas (postcode, suburb);
create index if not exists agent_service_areas_agent_idx
  on research.agent_service_areas (agent_id);
create index if not exists agent_service_areas_agency_idx
  on research.agent_service_areas (agency_id);

create table if not exists research.ad_area_matches (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  postcode text not null,
  suburb text not null,
  state text not null default 'WA',
  match_type text not null
    check (match_type in (
      'meta_targeting',
      'copy_mention',
      'agent_service_area',
      'agency_service_area',
      'landing_url',
      'manual'
    )),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ad_area_matches_unique_idx
  on research.ad_area_matches (observed_ad_id, postcode, suburb, match_type);
create index if not exists ad_area_matches_postcode_idx
  on research.ad_area_matches (postcode, suburb);

alter table research.agent_service_areas enable row level security;
alter table research.ad_area_matches enable row level security;

revoke all on research.agent_service_areas from public, anon, authenticated;
revoke all on research.ad_area_matches from public, anon, authenticated;

grant select, insert, update, delete on research.agent_service_areas to service_role;
grant select, insert, update, delete on research.ad_area_matches to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'research'
      and tablename = 'agent_service_areas'
      and policyname = 'agent_service_areas_service_role_all'
  ) then
    create policy agent_service_areas_service_role_all
      on research.agent_service_areas
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'research'
      and tablename = 'ad_area_matches'
      and policyname = 'ad_area_matches_service_role_all'
  ) then
    create policy ad_area_matches_service_role_all
      on research.ad_area_matches
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
