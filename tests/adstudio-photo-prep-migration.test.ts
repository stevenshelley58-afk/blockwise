import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606200002_adstudio_photo_prep_assets.sql";
const archiveMigrationPath = "supabase/migrations/202606200003_archive_legacy_adstudio_repair_assets.sql";
const sql = readFileSync(migrationPath, "utf8");
const archiveSql = readFileSync(archiveMigrationPath, "utf8");

test("photo prep migration creates a workspace scoped prepared asset table", () => {
  assert.match(sql, /create table if not exists public\.adstudio_photo_prep_assets/i);
  assert.match(sql, /workspace_id uuid not null references public\.workspaces/i);
  assert.match(sql, /brand_kit_id uuid references public\.adstudio_brand_kits/i);
  assert.match(sql, /source_image_hash text not null/i);
  assert.match(sql, /template_key text not null/i);
  assert.match(sql, /template_version integer not null default 1/i);
  assert.match(sql, /frame_id text not null/i);
  assert.match(sql, /cache_key text not null/i);
  assert.match(sql, /prompt_version_id uuid references public\.prompt_versions/i);
  assert.match(sql, /model_profile_key text not null default 'image_final'/i);
});

test("photo prep migration constrains method format qa status and cache uniqueness", () => {
  assert.match(sql, /format in \('9:16', '4:5', '1:1', '1\.91:1'\)/i);
  assert.match(sql, /method in \([\s\S]*'deterministic_smart_crop'[\s\S]*'model_reframe'[\s\S]*'model_extend'[\s\S]*'fallback_smart_crop'[\s\S]*'legacy_imported'/i);
  assert.match(sql, /qa_status in \('pending', 'passed', 'failed'\)/i);
  assert.match(sql, /create unique index if not exists adstudio_photo_prep_assets_workspace_cache_unique/i);
  assert.match(sql, /on public\.adstudio_photo_prep_assets \(workspace_id, cache_key\)/i);
});

test("photo prep migration keeps rows server-owned under RLS", () => {
  assert.match(sql, /alter table public\.adstudio_photo_prep_assets enable row level security/i);
  assert.match(sql, /create policy adstudio_photo_prep_assets_workspace_select/i);
  assert.match(sql, /public\.is_workspace_member\(workspace_id\)/i);
  assert.match(sql, /create policy adstudio_photo_prep_assets_server_owned_no_client_insert/i);
  assert.match(sql, /for insert to authenticated with check \(false\)/i);
  assert.match(sql, /for update to authenticated using \(false\) with check \(false\)/i);
  assert.match(sql, /for delete to authenticated using \(false\)/i);
});

test("photo prep migration backfills old repair assets without deleting brand assets", () => {
  assert.match(sql, /insert into public\.adstudio_photo_prep_assets/i);
  assert.match(sql, /from public\.adstudio_brand_assets asset/i);
  assert.match(sql, /where asset\.metadata_json->>'aiRepair' = 'true'/i);
  assert.match(sql, /'legacy-repair:' \|\| asset\.id::text/i);
  assert.match(sql, /'legacy_imported'/i);
  assert.match(sql, /on conflict \(workspace_id, cache_key\) do nothing/i);
  assert.doesNotMatch(sql, /delete from public\.adstudio_brand_assets/i);
  assert.doesNotMatch(sql, /drop table/i);
});

test("photo prep archive migration row-checks legacy repair assets before live cleanup", () => {
  assert.match(archiveSql, /create schema if not exists legacy_archive/i);
  assert.match(archiveSql, /legacy_archive\.adstudio_brand_assets_ai_repair_20260620/i);
  assert.match(archiveSql, /where asset\.metadata_json->>'aiRepair' = 'true'/i);
  assert.match(archiveSql, /archived_count <> legacy_count/i);
  assert.match(archiveSql, /raise exception 'Refusing to delete legacy Ad Studio repair assets/i);
  assert.match(archiveSql, /delete from public\.adstudio_brand_assets asset/i);
  assert.match(archiveSql, /from legacy_archive\.adstudio_brand_assets_ai_repair_20260620 archive/i);
  assert.doesNotMatch(archiveSql, /drop table/i);
});
