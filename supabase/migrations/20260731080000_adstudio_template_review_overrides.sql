-- Template review edits made on Vercel cannot be written to the bundled
-- template-gallery JSON files (read-only filesystem), so they are persisted
-- here and merged over the on-disk templates at read time. The apply script
-- (scripts/adstudio/apply-template-review-overrides.mjs) folds rows back into
-- git as the canonical source.
begin;

create table if not exists public.adstudio_template_review_overrides (
  template_id text primary key check (template_id ~ '^[a-zA-Z0-9_-]+$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

-- Operator-internal data: service-role access only, no public policies.
alter table public.adstudio_template_review_overrides enable row level security;

revoke all on table public.adstudio_template_review_overrides from public, anon, authenticated;

commit;
