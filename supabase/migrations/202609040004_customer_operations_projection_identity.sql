-- Repair the enquiry projection identity without editing the already-published
-- operations migrations. Source/provider identifiers remain source-table-only;
-- Hermes receives the durable Blockwise association UUID and sequence version.
begin;

create or replace function public.ops_enqueue_enquiry_projection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_version bigint;
begin
  if new.workspace_id is null then return new; end if;
  v_version := nextval('public.ops_projection_source_version_seq');
  perform public.enqueue_ops_projection(
    new.workspace_id,
    'chatwoot',
    'enquiry',
    new.id::text,
    'upsert',
    'enquiry-association:' || new.id::text || ':' || v_version::text,
    v_version,
    jsonb_build_object(
      'workspaceId', new.workspace_id::text,
      'subject', coalesce(new.subject, ''),
      'status', new.status
    )
  );
  return new;
end;
$$;

drop trigger if exists ops_enquiry_projection on public.ops_enquiry_associations;
create trigger ops_enquiry_projection
  after insert or update of workspace_id, status, subject
  on public.ops_enquiry_associations
  for each row execute function public.ops_enqueue_enquiry_projection();

revoke all on function public.ops_enqueue_enquiry_projection() from public, anon, authenticated;
commit;
