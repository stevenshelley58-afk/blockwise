-- Reuse historical website evidence by its recorded owner without table scans.
--
-- No-op guard: the research schema was retired by the 20260728 VPS cutover,
-- so databases built from this chain have no research.source_documents and
-- skip these indexes with a notice instead of failing. Databases that still
-- carry the pre-cutover table get the original indexes below.

do $$
begin
  if to_regclass('research.source_documents') is null then
    raise notice 'Skipping 202609080006: research.source_documents is absent (research schema retired).';
    return;
  end if;

create index if not exists source_documents_agency_evidence_idx
on research.source_documents ((metadata->>'agency_id'), source, fetched_at desc)
where metadata->>'agency_id' is not null;
create index if not exists source_documents_agent_evidence_idx
on research.source_documents ((metadata->>'agent_id'), source, fetched_at desc)
where metadata->>'agent_id' is not null;
create index if not exists source_documents_subject_evidence_idx
on research.source_documents ((metadata->>'subject_kind'), (metadata->>'subject_id'), fetched_at desc)
where metadata->>'subject_kind' is not null and metadata->>'subject_id' is not null;
create index if not exists source_documents_url_evidence_idx
on research.source_documents (source_url, source, fetched_at desc)
where source_url is not null;
end
$$;
