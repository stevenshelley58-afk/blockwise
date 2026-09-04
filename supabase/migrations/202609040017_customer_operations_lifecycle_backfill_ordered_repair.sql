-- Complete the ordered upgrade for installations where migration 015 already
-- marked legacy rows before the first replacement pass ran. Only rows carrying
-- that exact marker and lacking a replacement are eligible.
begin;

create or replace function public.repair_ops_superseded_lifecycle_projections()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer := 0;
  v_stage text;
  v_contact_version bigint;
  v_lifecycle_version bigint;
  r record;
  m record;
begin
  for r in
    select o.*
      from public.ops_projection_outbox o
     where o.provider = 'mautic'
       and o.aggregate_type = 'lifecycle'
       and o.aggregate_id = o.workspace_id::text
       and o.last_error = 'superseded_legacy_workspace_lifecycle_identity'
       and not exists (
         select 1 from public.ops_projection_outbox replacement
          where replacement.provider = 'mautic'
            and replacement.aggregate_type = 'lifecycle'
            and replacement.workspace_id = o.workspace_id
            and replacement.source_event_id like 'legacy-lifecycle-repair:' || o.id::text || ':%'
       )
     order by o.created_at, o.id
  loop
    select case
      when r.source_event_id like 'billing:%' then 'customer'
      when r.source_event_id like 'preference:%' then coalesce(nullif(r.payload ->> 'stage',''), 'unknown')
      when a.activation_completed_at is not null then 'active'
      when a.checkout_completed_at is not null then 'activated'
      when a.email_verified_at is not null then 'trial'
      else coalesce(nullif(r.payload ->> 'stage',''), 'lead')
    end
      into v_stage
      from (select 1) seed
      left join public.customer_activations a on a.workspace_id = r.workspace_id;

    for m in
      select wm.workspace_id, wm.profile_id
        from public.workspace_members wm
        join public.profiles p on p.id = wm.profile_id
       where wm.workspace_id = r.workspace_id
         and nullif(btrim(p.email),'') is not null
       order by wm.profile_id
    loop
      select nextval('public.ops_projection_source_version_seq') into v_contact_version;
      perform public.enqueue_ops_projection(
        m.workspace_id, 'mautic', 'contact', m.profile_id::text, 'upsert',
        'legacy-lifecycle-contact:' || r.id::text || ':' || m.profile_id::text,
        v_contact_version,
        jsonb_build_object('workspaceId', m.workspace_id::text, 'profileId', m.profile_id::text, 'sourceEventId', 'legacy-lifecycle-repair')
      );
      select nextval('public.ops_projection_source_version_seq') into v_lifecycle_version;
      perform public.enqueue_ops_projection(
        m.workspace_id, 'mautic', 'lifecycle', m.profile_id::text, 'upsert',
        'legacy-lifecycle-repair:' || r.id::text || ':' || m.profile_id::text,
        v_lifecycle_version,
        jsonb_build_object('workspaceId', m.workspace_id::text, 'profileId', m.profile_id::text, 'sourceEventId', 'legacy-lifecycle-repair', 'stage', v_stage)
      );
    end loop;

    update public.ops_projection_outbox
       set status = 'completed', completed_at = coalesce(completed_at, now()),
           last_error = 'repaired_legacy_workspace_lifecycle_identity',
           lease_token = null, lease_expires_at = null, updated_at = now()
     where id = r.id;
    v_rows := v_rows + 1;
  end loop;
  return v_rows;
end;
$$;

revoke all on function public.repair_ops_superseded_lifecycle_projections() from public, anon, authenticated;
grant execute on function public.repair_ops_superseded_lifecycle_projections() to service_role;

-- This is intentionally separate from 016 so a 015-completed upgrade is
-- repaired even if the earlier worker function was not run during rollout.
select public.repair_ops_superseded_lifecycle_projections();

commit;
