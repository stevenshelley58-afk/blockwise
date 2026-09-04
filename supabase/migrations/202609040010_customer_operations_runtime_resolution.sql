-- Just-in-time service contract for Hermes projection delivery.
-- The outbox remains provider-neutral; transient PII is resolved only while a
-- leased job is being processed and is never copied into a durable receipt.
begin;

create table if not exists public.ops_provider_correlations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('mautic','chatwoot')),
  aggregate_type text not null,
  aggregate_id text not null,
  provider_record_suffix text not null check (provider_record_suffix ~ '\\*'),
  source_version bigint not null check (source_version > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider, aggregate_type, aggregate_id)
);
alter table public.ops_provider_correlations enable row level security;
revoke all on public.ops_provider_correlations from public, anon, authenticated;
grant select on public.ops_provider_correlations to service_role;

create or replace function public.resolve_ops_provider_correlation(p_workspace_id uuid, p_provider text, p_aggregate_type text, p_aggregate_id text)
returns text language sql security definer set search_path = '' as $$
  select provider_record_suffix from public.ops_provider_correlations where workspace_id = p_workspace_id and provider = p_provider and aggregate_type = p_aggregate_type and aggregate_id = p_aggregate_id;
$$;
create or replace function public.record_ops_provider_correlation(p_workspace_id uuid, p_provider text, p_aggregate_type text, p_aggregate_id text, p_provider_record_suffix text, p_source_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_record_suffix is null or p_provider_record_suffix !~ '\\*' then raise exception 'provider correlation must be masked' using errcode = '22023'; end if;
  insert into public.ops_provider_correlations values (p_workspace_id,p_provider,p_aggregate_type,p_aggregate_id,left(p_provider_record_suffix,12),p_source_version,now()) on conflict (workspace_id,provider,aggregate_type,aggregate_id) do update set provider_record_suffix=excluded.provider_record_suffix,source_version=greatest(public.ops_provider_correlations.source_version,excluded.source_version),updated_at=now();
  return true;
end;
$$;
revoke all on function public.resolve_ops_provider_correlation(uuid,text,text,text), public.record_ops_provider_correlation(uuid,text,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.resolve_ops_provider_correlation(uuid,text,text,text), public.record_ops_provider_correlation(uuid,text,text,text,text,bigint) to service_role;

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
    -- Lifecycle enrollment is a provider operation on a real customer
    -- contact, never on a synthetic workspace contact. Require the aggregate
    -- to be an actual member of this workspace before resolving its stage.
    select jsonb_build_object('profileId', wm.profile_id::text)
      || case when a.workspace_id is null then '{}'::jsonb else jsonb_build_object('stage', case when a.activation_completed_at is not null then 'completed' when a.checkout_completed_at is not null then 'customer' when a.email_verified_at is not null then 'trial' else 'unknown' end, 'changedAt', a.updated_at) end
      into v_data
    from public.workspace_members wm
    left join public.customer_activations a on a.workspace_id = wm.workspace_id
    where wm.workspace_id = p_workspace_id and wm.profile_id::text = p_aggregate_id;
  elsif p_aggregate_type in ('enquiry','support') then
    -- Association rows are the only legal customer link. A global enquiry has
    -- no workspace and therefore returns NULL: no email-based inference.
    select jsonb_build_object('subject', left(coalesce(e.subject,''),512), 'status', left(coalesce(e.status,''),64), 'requesterEmail', left(coalesce(e.requester_email,''),320), 'requesterName', left(coalesce(e.requester_name,''),256))
      || case when e.source_system = 'blockwise' and e.enquiry_type = 'demo_request' then coalesce((select jsonb_build_object('message', left(coalesce(d.message,''),2000)) from public.demo_requests d where d.id::text = e.source_id), '{}'::jsonb) else '{}'::jsonb end into v_data
    from public.ops_enquiry_associations e
    where e.workspace_id = p_workspace_id
      and (e.id::text = p_aggregate_id or (e.source_system = 'blockwise' and e.source_id = p_aggregate_id));
  end if;
  return v_data;
end;
$$;

revoke all on function public.resolve_ops_projection_data(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.resolve_ops_projection_data(uuid,text,text,text) to service_role;
comment on function public.resolve_ops_projection_data(uuid,text,text,text) is
  'Service-only just-in-time projection data; never expose provider IDs or use email to infer workspace identity.';

commit;
