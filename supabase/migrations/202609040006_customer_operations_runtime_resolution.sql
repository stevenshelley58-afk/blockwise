-- Just-in-time service contract for Hermes projection delivery.
-- The outbox remains provider-neutral; transient PII is resolved only while a
-- leased job is being processed and is never copied into a durable receipt.
begin;

create or replace function public.resolve_ops_projection_data(
  p_workspace_id uuid, p_provider text, p_aggregate_type text, p_aggregate_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_data jsonb;
begin
  if p_workspace_id is null or p_provider not in ('mautic','chatwoot')
    or not ((p_provider = 'mautic' and p_aggregate_type in ('contact','lifecycle'))
      or (p_provider = 'chatwoot' and p_aggregate_type in ('enquiry','support'))) then
    raise exception 'invalid projection resolution request' using errcode = '22023';
  end if;
  if p_aggregate_type = 'contact' then
    select jsonb_build_object('email', lower(btrim(p.email)), 'name', left(coalesce(p.full_name,''),512)) into v_data
    from public.profiles p
    join public.workspace_members wm on wm.profile_id = p.id and wm.workspace_id = p_workspace_id
    where p.id::text = p_aggregate_id;
  elsif p_aggregate_type = 'lifecycle' then
    select jsonb_build_object('stage', case when a.activation_completed_at is not null then 'completed' when a.checkout_completed_at is not null then 'customer' when a.email_verified_at is not null then 'trial' else 'unknown' end, 'changedAt', a.updated_at) into v_data
    from public.customer_activations a where a.workspace_id = p_workspace_id and p_aggregate_id = p_workspace_id::text;
  elsif p_aggregate_type in ('enquiry','support') then
    -- Association rows are the only legal customer link. A global enquiry has
    -- no workspace and therefore returns NULL: no email-based inference.
    select jsonb_build_object('subject', left(coalesce(e.subject,''),512), 'status', left(coalesce(e.status,''),64)) into v_data
    from public.ops_enquiry_associations e where e.id::text = p_aggregate_id and e.workspace_id = p_workspace_id;
  end if;
  return v_data;
end;
$$;

revoke all on function public.resolve_ops_projection_data(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.resolve_ops_projection_data(uuid,text,text,text) to service_role;
comment on function public.resolve_ops_projection_data(uuid,text,text,text) is
  'Service-only just-in-time projection data; never expose provider IDs or use email to infer workspace identity.';

commit;
