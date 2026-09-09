-- Directory entity evidence lookup. The worker filters both metadata identity
-- fields and orders the newest evidence; keep this narrow expression index
-- instead of adding a broad JSON index.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
create index if not exists source_documents_entity_lookup_idx
  on research.source_documents
    ((metadata->>'entity_kind'), (metadata->>'entity_id'), fetched_at desc)
  where metadata->>'entity_kind' is not null
    and metadata->>'entity_id' is not null;
comment on index research.source_documents_entity_lookup_idx is
  'Exact directory entity evidence lookup by metadata identity, newest first.';
commit;
