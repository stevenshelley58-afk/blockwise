-- Phase 2: Synthetic agent library — additive migration.
--
-- Adds research.synthetic_agents to store fictional AU agent portraits used in
-- generic brand/lead templates. CHECK constraints enforce that every row is
-- always flagged synthetic and not-a-real-person at the DB level.
--
-- No existing table, view, API shape, auth, or provider behaviour is changed.

begin;

create table if not exists research.synthetic_agents (
  id                    uuid primary key default gen_random_uuid(),
  -- Stable human key matching AGENT_PERSONAS in synthetic-agents.ts
  persona_key           text not null unique,
  -- Fixed seed — the same seed always produces the same persona appearance.
  seed                  integer not null,
  gender                text,
  age_range             text,
  attire                text,
  setting               text,
  -- Storage path for the generated portrait (workspace-artifacts bucket).
  portrait_storage_path text,
  -- These two booleans are CHECK-constrained to always be true.
  -- They cannot be set false; the constraint is the enforcement mechanism.
  is_synthetic          boolean not null default true,
  not_a_real_person     boolean not null default true,
  generated_at          timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint synthetic_agents_always_synthetic
    check (is_synthetic = true),
  constraint synthetic_agents_always_not_real_person
    check (not_a_real_person = true)
);

create index if not exists synthetic_agents_persona_key_idx
  on research.synthetic_agents (persona_key);

comment on table research.synthetic_agents is
  'Fictional AU real estate agent portraits for generic brand/lead templates. '
  'is_synthetic and not_a_real_person are always true (DB-enforced). '
  'Never derived from or linked to a real agent in the radar.';

-- RLS: service_role writes only, mirroring sibling research.* tables.
alter table research.synthetic_agents enable row level security;
revoke all on research.synthetic_agents from public, anon, authenticated;
grant all on research.synthetic_agents to service_role;

create policy "synthetic_agents_service_role_all" on research.synthetic_agents
  as permissive for all to service_role using (true) with check (true);

-- Add updated_at trigger.
create trigger trg_synthetic_agents_updated_at
  before update on research.synthetic_agents
  for each row execute function research.set_updated_at();

commit;
