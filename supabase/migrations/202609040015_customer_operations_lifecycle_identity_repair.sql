-- Retire legacy workspace-level lifecycle work. A workspace is not a Mautic
-- contact; the contract-compliant member/profile rows are authoritative.
begin;

update public.ops_projection_outbox o
   set status = 'completed',
       completed_at = now(),
       last_error = 'superseded_legacy_workspace_lifecycle_identity',
       lease_token = null,
       lease_expires_at = null,
       updated_at = now()
 where o.provider = 'mautic'
   and o.aggregate_type = 'lifecycle'
   and o.aggregate_id = o.workspace_id::text
   and o.status in ('pending', 'processing');

commit;
