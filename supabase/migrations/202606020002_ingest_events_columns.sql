-- Ensure research.ingest_events carries the full audit-trail foreign keys.
--
-- The supervisor previously stripped these columns in a compatibility fallback
-- whenever a schema-cache mismatch was hit, silently breaking the audit trail.
-- Guaranteeing the columns exist lets the runtime write them unconditionally.
alter table research.ingest_events
  add column if not exists work_queue_id uuid,
  add column if not exists agent_decision_id uuid,
  add column if not exists source_document_id uuid,
  add column if not exists build_run_id uuid,
  add column if not exists ad_fetch_run_id uuid,
  add column if not exists payload_hash text,
  add column if not exists diff jsonb;
