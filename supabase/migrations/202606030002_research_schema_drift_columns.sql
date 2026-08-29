-- Add columns the live supervisor writes that this DB was missing (schema drift
-- from 202605300003 being edited after it had already been applied here).
alter table research.advertiser_pages
  add column if not exists resolution_decision_id uuid references research.agent_decisions (id) on delete set null,
  add column if not exists resolved_at timestamptz;

alter table research.ad_fetch_runs
  add column if not exists build_run_id uuid references research.build_runs (id) on delete set null,
  add column if not exists work_queue_id uuid references research.work_queue (id) on delete set null;

alter table research.coverage_defects
  add column if not exists reporter_identity text,
  add column if not exists resolution_decision_id uuid references research.agent_decisions (id) on delete set null,
  add column if not exists resolved_agent_id uuid references research.agents (id) on delete set null,
  add column if not exists resolved_agency_id uuid references research.agencies (id) on delete set null,
  add column if not exists resolved_advertiser_page_id uuid references research.advertiser_pages (id) on delete set null;

notify pgrst, 'reload schema';
