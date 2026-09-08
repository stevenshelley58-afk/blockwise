-- Reuse historical website evidence by its recorded owner without table scans.
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
