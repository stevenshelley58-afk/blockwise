-- Enable RLS + service-role-only access on two research-schema bookkeeping
-- tables created without it: research.target_manifest, research.source_fetch_log.
--
-- Both were created (202606100001 / 202606100002) without the RLS block every
-- other research table carries, so the Supabase security advisor flagged them as
-- fully exposed to the anon/authenticated roles (critical). They are
-- Hermes/service-role-only (0 rows, no Vercel app references); service_role
-- bypasses RLS, so Hermes is unaffected. This only removes the public exposure
-- and matches the established research-table security pattern.
--
-- Applied to prod via MCP as migration version 20260620135329.

begin;

alter table research.target_manifest enable row level security;
alter table research.source_fetch_log enable row level security;

revoke all on research.target_manifest from public, anon, authenticated;
revoke all on research.source_fetch_log from public, anon, authenticated;

grant all on research.target_manifest to service_role;
grant all on research.source_fetch_log to service_role;

drop policy if exists "target_manifest_service_role_all" on research.target_manifest;
create policy "target_manifest_service_role_all" on research.target_manifest
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "source_fetch_log_service_role_all" on research.source_fetch_log;
create policy "source_fetch_log_service_role_all" on research.source_fetch_log
  as permissive for all to service_role using (true) with check (true);

commit;
