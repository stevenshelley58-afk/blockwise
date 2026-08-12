-- Migration: ad_customer_ads + revisions + render attempts + forms + snapshots
-- Phase 5: Blockwise persistence and Save
-- Idempotent — safe to re-run.

-- Customer ads referencing a template pack
create table if not exists ad_customer_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  template_pack_id text not null references ad_template_packs(pack_id) on delete restrict,
  template_id text not null,
  template_version int not null,
  active_revision_id uuid,
  colour_mode text not null default 'template' check (colour_mode in ('template', 'brand_pack')),
  resolved_colour_map jsonb not null default '{}'::jsonb,
  meta_primary_text text not null default '',
  meta_headline text not null default '',
  meta_description text not null default '',
  meta_cta text not null default 'LEARN_MORE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immutable ad revisions (one row per Save)
create table if not exists ad_revisions (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ad_customer_ads(id) on delete cascade,
  workspace_id uuid not null,
  revision_number int not null,
  document_json jsonb not null,
  document_hash text not null,
  feed_png_hash text,
  feed_png_path text,
  story_png_hash text,
  story_png_path text,
  template_hash text not null,
  renderer_version text not null,
  created_at timestamptz not null default now(),
  unique(ad_id, revision_number)
);

-- Render attempts (one per placement per revision)
create table if not exists ad_render_attempts (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references ad_revisions(id) on delete cascade,
  workspace_id uuid not null,
  placement text not null check (placement in ('feed', 'story')),
  png_hash text not null,
  png_path text,
  renderer_version text not null,
  duration_ms int,
  created_at timestamptz not null default now(),
  unique(revision_id, placement)
);

-- AI-generated Instant Form drafts
create table if not exists ad_instant_form_drafts (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ad_customer_ads(id) on delete cascade,
  workspace_id uuid not null,
  form_json jsonb not null,
  form_hash text not null,
  generated_by text,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  unique(ad_id, revision)
);

-- Locked publication snapshots
create table if not exists ad_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ad_customer_ads(id) on delete cascade,
  workspace_id uuid not null,
  revision_id uuid not null references ad_revisions(id) on delete restrict,
  form_draft_id uuid references ad_instant_form_drafts(id) on delete restrict,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(ad_id, revision_id)
);

-- Indexes
create index if not exists idx_customer_ads_workspace on ad_customer_ads(workspace_id);
create index if not exists idx_customer_ads_pack on ad_customer_ads(template_pack_id);
create index if not exists idx_revisions_ad on ad_revisions(ad_id);
create index if not exists idx_revisions_workspace on ad_revisions(workspace_id);
create index if not exists idx_render_attempts_revision on ad_render_attempts(revision_id);
create index if not exists idx_form_drafts_ad on ad_instant_form_drafts(ad_id);
create index if not exists idx_publication_snapshots_ad on ad_publication_snapshots(ad_id);
