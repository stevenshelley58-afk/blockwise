-- Hermes-only Mautic customer action lane.
--
-- Frank may submit a stable flow alias, but never a Mautic identifier. The
-- mapping and the provider contact identity remain service-only. Provider
-- readiness is intentionally deployment state and is refreshed by Hermes.
begin;

create table if not exists private.ops_mautic_flow_mappings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_alias text not null check (flow_alias ~ '^[A-Za-z0-9._:-]{1,128}$'),
  segment_id text check (segment_id is null or segment_id ~ '^[1-9][0-9]{0,18}$'),
  campaign_id text check (campaign_id is null or campaign_id ~ '^[1-9][0-9]{0,18}$'),
  enabled boolean not null default true,
  verified_at timestamptz,
  expires_at timestamptz,
  verification_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, flow_alias),
  check (segment_id is not null or campaign_id is not null),
  check ((verified_at is null and expires_at is null) or (verified_at is not null and expires_at is not null)),
  check (verification_error is null or char_length(verification_error) <= 512)
);
alter table private.ops_mautic_flow_mappings enable row level security;
revoke all on private.ops_mautic_flow_mappings from public, anon, authenticated, service_role;

create or replace function public.configure_ops_mautic_flow_mapping(
  p_workspace_id uuid, p_flow_alias text, p_segment_id text default null,
  p_campaign_id text default null, p_enabled boolean default true,
  p_verified_at timestamptz default null, p_expires_at timestamptz default null,
  p_verification_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_workspace_id is null or nullif(btrim(p_flow_alias), '') is null
    or p_flow_alias !~ '^[A-Za-z0-9._:-]{1,128}$'
    or (p_segment_id is null and p_campaign_id is null)
    or (p_segment_id is not null and p_segment_id !~ '^[1-9][0-9]{0,18}$')
    or (p_campaign_id is not null and p_campaign_id !~ '^[1-9][0-9]{0,18}$')
    or (p_verified_at is null and p_expires_at is not null)
    or (p_verified_at is not null and p_expires_at is null)
    or (p_expires_at is not null and p_expires_at <= p_verified_at)
  then raise exception 'invalid Mautic flow mapping' using errcode = '22023'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Mautic flow mapping workspace does not exist' using errcode = '23503';
  end if;
  insert into private.ops_mautic_flow_mappings(
    workspace_id, flow_alias, segment_id, campaign_id, enabled,
    verified_at, expires_at, verification_error, updated_at
  ) values (
    p_workspace_id, lower(btrim(p_flow_alias)), p_segment_id, p_campaign_id,
    coalesce(p_enabled, true), p_verified_at, p_expires_at,
    left(p_verification_error, 512), now()
  ) on conflict (workspace_id, flow_alias) do update set
    segment_id = excluded.segment_id, campaign_id = excluded.campaign_id,
    enabled = excluded.enabled, verified_at = excluded.verified_at,
    expires_at = excluded.expires_at, verification_error = excluded.verification_error,
    updated_at = now();
  return true;
end; $$;
revoke all on function public.configure_ops_mautic_flow_mapping(uuid,text,text,text,boolean,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.configure_ops_mautic_flow_mapping(uuid,text,text,text,boolean,timestamptz,timestamptz,text) to service_role;

create or replace function public.resolve_ops_mautic_flow_mapping(
  p_workspace_id uuid, p_flow_alias text
) returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'segment_id', segment_id, 'campaign_id', campaign_id,
    'verified_at', verified_at, 'expires_at', expires_at
  )
  from private.ops_mautic_flow_mappings
  where workspace_id = p_workspace_id and flow_alias = lower(btrim(p_flow_alias))
    and enabled and verified_at is not null and expires_at > now();
$$;
revoke all on function public.resolve_ops_mautic_flow_mapping(uuid,text) from public, anon, authenticated;
grant execute on function public.resolve_ops_mautic_flow_mapping(uuid,text) to service_role;

create or replace function public.resolve_ops_mautic_action_identity(
  p_workspace_id uuid, p_profile_id uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'ciphertext', l.provider_contact_id_ciphertext,
    'digest', l.provider_contact_id_digest
  )
  from private.ops_provider_operation_ledger l
  where l.workspace_id = p_workspace_id and l.provider = 'mautic'
    and l.aggregate_type = 'contact' and l.aggregate_id = p_profile_id::text
    and l.provider_contact_id_ciphertext is not null
  order by l.source_version desc, l.updated_at desc limit 1;
$$;
revoke all on function public.resolve_ops_mautic_action_identity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_ops_mautic_action_identity(uuid,uuid) to service_role;

create or replace function public.set_ops_mautic_capability(
  p_enabled boolean, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ops_action_capabilities
  set capability_state = case when p_enabled then 'available' else 'capability_required' end,
      description = left(coalesce(p_reason, 'Mautic worker readiness unavailable'), 256),
      updated_at = now(), verified_at = case when p_enabled then now() else null end,
      expires_at = case when p_enabled then now() + interval '2 minutes' else null end,
      verification_error = case when p_enabled then null else left(coalesce(p_reason, 'unavailable'), 512) end
  where action_type in (
    'consent_grant', 'consent_withdraw', 'consent_unsubscribe',
    'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume'
  );
  return true;
end; $$;
revoke all on function public.set_ops_mautic_capability(boolean,text) from public, anon, authenticated;
grant execute on function public.set_ops_mautic_capability(boolean,text) to service_role;

-- Provider actions are claimed only while their capability has a fresh health
-- verification. This leaves actions pending when credentials or health fail.
create or replace function public.claim_ops_provider_action(p_lease_seconds integer default 600)
returns table (id uuid, action_id uuid, workspace_id uuid, customer_id uuid, actor_operator_id uuid, actor_role text,
  action_type text, target_type text, target_id uuid, expected_version bigint, reason text, payload jsonb,
  attempts integer, max_attempts integer, expires_at timestamptz, lease_token uuid)
language sql security definer set search_path = '' as $$
  update public.ops_action_outbox as o set status = 'processing', attempts = o.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds,600),3600))), updated_at = now()
  where o.id = (
    select c.id from public.ops_action_outbox c
    join public.ops_action_capabilities cap on cap.action_type = c.action_type
    where c.status = 'pending' and c.run_after <= now() and c.expires_at > now() and c.attempts < c.max_attempts
      and c.action_type in (
        'consent_grant', 'consent_withdraw', 'consent_unsubscribe',
        'suppression_add', 'suppression_remove', 'flow_enroll', 'flow_pause', 'flow_resume',
        'enquiry_close', 'enquiry_reply', 'enquiry_reopen'
      )
      and cap.capability_state = 'available' and cap.verified_at is not null and cap.expires_at > now()
      and not exists (
        select 1 from public.ops_action_outbox newer
        where newer.workspace_id = c.workspace_id and newer.target_type = c.target_type
          and newer.target_id = c.target_id and newer.expected_version > c.expected_version
          and newer.status not in ('rejected','expired','superseded')
      )
    order by c.run_after, c.created_at, c.id for update skip locked limit 1
  )
  returning o.id, o.action_id, o.workspace_id, o.customer_id, o.actor_operator_id, o.actor_role,
    o.action_type, o.target_type, o.target_id, o.expected_version, o.reason, o.payload,
    o.attempts, o.max_attempts, o.expires_at, o.lease_token;
$$;
revoke all on function public.claim_ops_provider_action(integer) from public, anon, authenticated;
grant execute on function public.claim_ops_provider_action(integer) to service_role;

commit;
