-- QA verdicts removed from AdBuilder; the jobs qa column was always advisory
-- and is unread by every code path after the region-detection split.
alter table public.adbuilder_creative_jobs drop column if exists qa;
