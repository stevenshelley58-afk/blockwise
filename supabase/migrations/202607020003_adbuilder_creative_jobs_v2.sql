-- P1.3 async ad generation: extend adbuilder_creative_jobs for the trigger.dev
-- template-campaign pipeline. The campaigns POST route enqueues a row (payload =
-- the full CreateCampaignBody plus the trial-credit reservation), the
-- "adbuilder.generate.template" task executes it, and the client polls
-- GET /api/adbuilder/jobs/[id]. Additive only — legacy columns stay.

alter table public.adbuilder_creative_jobs
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.adbuilder_creative_jobs
  add column if not exists campaign_id uuid;

alter table public.adbuilder_creative_jobs
  add column if not exists qa jsonb;

alter table public.adbuilder_creative_jobs
  add column if not exists kind text not null default 'template_campaign';

-- Legacy VPS-worker column: the new pipeline stores the request in payload, so
-- headline must not block inserts (it was created not-null with no default).
alter table public.adbuilder_creative_jobs
  alter column headline set default '';

-- Workspace members may READ job status (the polling GET route runs on the
-- user-scoped client). Inserts/updates stay service-role only — no policies.
drop policy if exists adbuilder_creative_jobs_select on public.adbuilder_creative_jobs;

create policy adbuilder_creative_jobs_select on public.adbuilder_creative_jobs
  for select
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));
