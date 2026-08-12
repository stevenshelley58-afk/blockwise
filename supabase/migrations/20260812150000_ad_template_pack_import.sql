-- Migration: ad_template_packs import support
-- Creates tables for immutable imported TemplatePacks from Frank.
-- Idempotent — safe to re-run.

-- Import receipts with idempotency
create table if not exists ad_import_receipts (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null unique,
  pack_sha256 text not null,
  build_id text not null,
  issuer text not null,
  issued_at timestamptz not null,
  nonce text not null,
  signature text not null,
  status text not null default 'quarantined' check (status in ('quarantined', 'active', 'rejected')),
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-use nonce tracking
create table if not exists ad_import_nonces (
  nonce text primary key,
  used_at timestamptz not null default now()
);

-- Immutable template packs
create table if not exists ad_template_packs (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null unique,
  template_id text not null,
  version int not null,
  schema_version text not null default 'blockwise.template-pack/v1',
  manifest_sha256 text not null,
  signature text not null,
  pack_json jsonb not null,
  created_at timestamptz not null default now()
);

-- Template pack version history
create table if not exists ad_template_pack_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null references ad_template_packs(pack_id) on delete cascade,
  version int not null,
  manifest_sha256 text not null,
  pack_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(pack_id, version)
);

-- Asset metadata
create table if not exists ad_template_assets (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null references ad_template_packs(pack_id) on delete cascade,
  asset_key text not null,
  file_name text not null,
  sha256 text not null,
  mime_type text not null,
  storage_path text,
  created_at timestamptz not null default now(),
  unique(pack_id, asset_key)
);

-- Indexes
create index if not exists idx_import_receipts_sha256 on ad_import_receipts(pack_sha256);
create index if not exists idx_import_nonces_used_at on ad_import_nonces(used_at);
create index if not exists idx_template_packs_template_id on ad_template_packs(template_id);
create index if not exists idx_template_assets_pack_id on ad_template_assets(pack_id);

-- Cleanup old nonces (keep 24h)
create or replace function cleanup_old_import_nonces()
returns void as $$
begin
  delete from ad_import_nonces where used_at < now() - interval '24 hours';
end;
$$ language plpgsql;
