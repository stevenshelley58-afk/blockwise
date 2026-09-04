-- New direct templates remain hidden until the corrected Hermes review run
-- has completed and an operator explicitly activates the immutable artifact.

alter table public.ad_templates
  add column if not exists library_review_run_id text,
  add column if not exists library_reviewed_at timestamptz;

alter table public.ad_templates
  alter column library_status set default 'quarantined';

comment on column public.ad_templates.library_review_run_id is
  'Hermes template-generation run whose corrected final review authorized customer discovery.';

comment on column public.ad_templates.library_reviewed_at is
  'Time the reviewed immutable template was explicitly activated for customer discovery.';
