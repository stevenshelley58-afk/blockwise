-- Customer freshness targets for the existing page collector.
--
-- customer_key is a service-side pseudonym. The isolated research database
-- never receives customer email, name, or workspace identifiers.
create table if not exists research.ad_radar_customer_interests (
  customer_key text primary key,
  agent_id uuid references research.agents (id) on delete set null,
  advertiser_page_id uuid references research.advertiser_pages (id) on delete set null,
  postcode text,
  state text,
  active boolean not null default true,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_radar_customer_interests_key_check
    check (length(btrim(customer_key)) between 32 and 200),
  constraint ad_radar_customer_interests_postcode_check
    check (postcode is null or postcode ~ '^[0-9]{4}$'),
  constraint ad_radar_customer_interests_state_check
    check (state is null or length(btrim(state)) between 2 and 32),
  constraint ad_radar_customer_interests_target_check
    check (agent_id is not null or advertiser_page_id is not null or postcode is not null)
);

comment on table research.ad_radar_customer_interests is
  'Service-side customer freshness targets. Used by the page scheduler; contains no customer PII.';

create index if not exists ad_radar_customer_interests_active_postcode_idx
  on research.ad_radar_customer_interests (postcode, state)
  where active = true and postcode is not null;
create index if not exists ad_radar_customer_interests_active_agent_idx
  on research.ad_radar_customer_interests (agent_id)
  where active = true and agent_id is not null;
create index if not exists ad_radar_customer_interests_active_page_idx
  on research.ad_radar_customer_interests (advertiser_page_id)
  where active = true and advertiser_page_id is not null;
create index if not exists ad_radar_customer_interests_sync_idx
  on research.ad_radar_customer_interests (active, last_synced_at desc);

alter table research.ad_radar_customer_interests enable row level security;
revoke all on research.ad_radar_customer_interests from public, anon, authenticated;
grant all on research.ad_radar_customer_interests to service_role;

notify pgrst, 'reload schema';
