-- QA verdicts removed from AdStudio; the jobs qa column was always advisory
-- and is unread by every code path after the region-detection split.
alter table public.adstudio_creative_jobs drop column if exists qa;
