-- RLS for ad_search_documents + media object_key backfill.
--
-- research.ad_search_documents is served to Blockwise through the
-- authenticated research API: service_role gets full access, matching every
-- other research table's policy pattern.
alter table research.ad_search_documents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'research'
      and tablename = 'ad_search_documents'
      and policyname = 'ad_search_documents_service_role_all'
  ) then
    create policy ad_search_documents_service_role_all
      on research.ad_search_documents
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- object_key is the canonical storage key; storage_path is provenance.
-- Backfill for rows captured with the legacy single-bucket layout.
update research.media_assets
set object_key = storage_path
where object_key is null
  and storage_path is not null
  and storage_path like '%';
