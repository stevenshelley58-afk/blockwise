begin;

-- Inline ad management on the Results page can mutate campaigns that did not
-- originate from a Blockwise publish plan (e.g. campaigns created directly in
-- Meta Ads Manager). Those mutations have no owning plan, so the plan FK must
-- be optional. When meta_publish_plan_id is null the mutation worker resolves
-- the Meta access token from the workspace's provider connection instead of a
-- plan. The FK (on delete cascade) already tolerates null, so we only need to
-- drop the NOT NULL constraint.
alter table public.meta_publish_plan_mutations
  alter column meta_publish_plan_id drop not null;

commit;
