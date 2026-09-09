-- Migration: Template pack storage maps + RLS for Phase 5/8 customer tables
-- Follow-up to 20260812150000 (import) and 20260812160000 (customer ads).
-- Idempotent — safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Storage location maps on ad_template_packs
--    The importer stores pack assets/fonts/previews in workspace-artifacts
--    storage; these JSONB maps record pack_id-relative storage paths.
-- ---------------------------------------------------------------------------

alter table ad_template_packs add column if not exists asset_map jsonb not null default '{}'::jsonb;
alter table ad_template_packs add column if not exists fonts_map jsonb not null default '{}'::jsonb;
alter table ad_template_packs add column if not exists previews_map jsonb not null default '{}'::jsonb;

-- Failed-attempt bookkeeping for Save: render attempts must also record
-- failures (Phase 5: "Failed attempts leave the previous saved revision
-- active" — but they must be visible for diagnostics). Failed attempts have
-- no revision yet, so revision_id becomes nullable and gains an error column.
alter table ad_render_attempts add column if not exists status text not null default 'success';
alter table ad_render_attempts drop constraint if exists ad_render_attempts_status_check;
alter table ad_render_attempts add constraint ad_render_attempts_status_check check (status in ('success', 'failed'));
alter table ad_render_attempts add column if not exists error text;
alter table ad_render_attempts alter column revision_id drop not null;
alter table ad_render_attempts alter column renderer_version drop not null;
alter table ad_render_attempts alter column png_hash drop not null;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security on all workspace-scoped Phase 5 tables
--    Service role bypasses RLS (Blockwise server writes); authenticated
--    customers touch their own workspace only via the member helper.
-- ---------------------------------------------------------------------------

alter table ad_customer_ads enable row level security;
alter table ad_revisions enable row level security;
alter table ad_render_attempts enable row level security;
alter table ad_instant_form_drafts enable row level security;
alter table ad_publication_snapshots enable row level security;

drop policy if exists ad_customer_ads_member_select on ad_customer_ads;
create policy ad_customer_ads_member_select on ad_customer_ads
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists ad_customer_ads_member_insert on ad_customer_ads;
create policy ad_customer_ads_member_insert on ad_customer_ads
  for insert to authenticated with check (public.is_workspace_member(workspace_id));

drop policy if exists ad_customer_ads_member_update on ad_customer_ads;
create policy ad_customer_ads_member_update on ad_customer_ads
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists ad_revisions_member_select on ad_revisions;
create policy ad_revisions_member_select on ad_revisions
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists ad_render_attempts_member_select on ad_render_attempts;
create policy ad_render_attempts_member_select on ad_render_attempts
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists ad_instant_form_drafts_member_select on ad_instant_form_drafts;
create policy ad_instant_form_drafts_member_select on ad_instant_form_drafts
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists ad_publication_snapshots_member_select on ad_publication_snapshots;
create policy ad_publication_snapshots_member_select on ad_publication_snapshots
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Import-side tables: operator-only reads, no customer access at all.
alter table ad_import_receipts enable row level security;
alter table ad_import_nonces enable row level security;
alter table ad_template_packs enable row level security;
alter table ad_template_pack_versions enable row level security;
alter table ad_template_assets enable row level security;

drop policy if exists ad_import_receipts_operator_select on ad_import_receipts;
create policy ad_import_receipts_operator_select on ad_import_receipts
  for select to authenticated using (public.is_operator());

drop policy if exists ad_template_packs_operator_select on ad_template_packs;
create policy ad_template_packs_operator_select on ad_template_packs
  for select to authenticated using (public.is_operator());

drop policy if exists ad_template_pack_versions_operator_select on ad_template_pack_versions;
create policy ad_template_pack_versions_operator_select on ad_template_pack_versions
  for select to authenticated using (public.is_operator());

drop policy if exists ad_template_assets_operator_select on ad_template_assets;
create policy ad_template_assets_operator_select on ad_template_assets
  for select to authenticated using (public.is_operator());

-- No non-operator policy on ad_import_nonces: invisible to every customer.
-- Writes go through the service role only (RLS bypass), matching the
-- importer + save transaction paths.

-- Workspace-scoped indexes for the RLS-filtered query shapes
create index if not exists idx_render_attempts_workspace on ad_render_attempts(workspace_id);
create index if not exists idx_form_drafts_workspace on ad_instant_form_drafts(workspace_id);
create index if not exists idx_publication_snapshots_workspace on ad_publication_snapshots(workspace_id);
