-- Presentation cache for the /audit local advertising intelligence report.
--
-- The /audit page derives a calm, data-grounded written report from public Meta
-- Ad Library aggregates. When the LLM copy pipeline produces a draft that passes
-- the deterministic sentence gate AND the frontier-AI review, the approved copy
-- is cached here keyed by a hash of the underlying scan inputs (`signature`).
--
-- This is a DERIVED PRESENTATION ARTIFACT, not research scrape state, so it lives
-- in `public` (Vercel may read/write it) rather than the service-role `research`
-- schema. It only ever holds copy already reviewed for the public page; the page
-- falls back to the deterministic in-code narrative on any cache miss or failure,
-- so this table is a cache and never a source of truth.

begin;

create table if not exists public.audit_report_copy (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the scan inputs that drive the copy (location + stats + signals).
  signature text not null unique
    check (btrim(signature) <> ''),
  location_label text not null
    check (btrim(location_label) <> ''),
  -- The approved AuditNarrative (snapshot, dataQuality, blocks, usefulActions,
  -- limitations, confidence) as rendered by the page.
  narrative jsonb not null
    check (jsonb_typeof(narrative) = 'object'),
  -- Frontier-AI reviewer verdict retained for audit/debugging.
  review jsonb,
  model text,
  source text not null default 'llm'
    check (source in ('llm', 'deterministic')),
  -- Diagnostics: attempts, signal snapshot, provider, latency.
  meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists audit_report_copy_location_idx
  on public.audit_report_copy (location_label);
create index if not exists audit_report_copy_expires_idx
  on public.audit_report_copy (expires_at)
  where expires_at is not null;

-- Service-role only: the page reads and writes this cache through the service
-- client. No anon/authenticated access is required or granted.
alter table public.audit_report_copy enable row level security;

revoke all on public.audit_report_copy from public, anon, authenticated;
grant select, insert, update, delete on public.audit_report_copy to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_report_copy'
      and policyname = 'audit_report_copy_service_role_all'
  ) then
    create policy audit_report_copy_service_role_all
      on public.audit_report_copy
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
