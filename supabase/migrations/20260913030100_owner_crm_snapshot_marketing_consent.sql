-- Bounded, read-only customer projection for the signed owner CRM bridge.
-- This is intentionally not a CRM sync engine and exposes no token, card,
-- provider-secret, arbitrary metadata, lead-delivery, or research fields.
begin;
create or replace function public.owner_crm_owner_email_verified_at(p_profile_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$ select coalesce(u.email_confirmed_at,u.confirmed_at) from auth.users u where u.id=p_profile_id $$;
revoke all on function public.owner_crm_owner_email_verified_at(uuid) from public,anon,authenticated;
grant execute on function public.owner_crm_owner_email_verified_at(uuid) to service_role;
grant select on table public.workspace_marketing_consent_events to service_role;
drop function if exists public.owner_crm_customer_snapshot_page(uuid, integer);

create or replace function public.owner_crm_customer_snapshot_page(
  p_after_workspace_id uuid default null,
  p_limit integer default 50
)
returns table (
  workspace_id uuid,
  billing_access_state text,
  stripe_subscription_status text,
  trial_state text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  source_observed_at timestamptz,
  owner_profile_id uuid,
  owner_full_name text,
  owner_email text,
  owner_count integer,
  owner_profile_workspace_count integer,
  owner_matches_created_by boolean,
  owner_email_verified_at timestamptz,
  marketing_consent_event_id uuid,
  marketing_consent_granted boolean,
  marketing_consent_occurred_at timestamptz,
  marketing_consent_policy_version text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'owner CRM snapshot page limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  return query
  with workspace_page as (
    select
      w.id,
      w.created_by,
      w.billing_access_state,
      w.stripe_subscription_status,
      w.trial_state,
      w.trial_started_at,
      w.trial_ends_at,
      statement_timestamp() as source_observed_at
    from public.workspaces w
    where p_after_workspace_id is null or w.id > p_after_workspace_id
    order by w.id asc
    limit p_limit
  )
  select
    workspace_page.id,
    workspace_page.billing_access_state,
    workspace_page.stripe_subscription_status,
    workspace_page.trial_state,
    workspace_page.trial_started_at,
    workspace_page.trial_ends_at,
    workspace_page.source_observed_at,
    owner_profile.id,
    owner_profile.full_name,
    owner_profile.email,
    coalesce(cardinality(owner_members.profile_ids), 0)::integer,
    owner_workspace_count.workspace_count,
    case
      when cardinality(owner_members.profile_ids) = 1
        then workspace_page.created_by is null or workspace_page.created_by = owner_members.profile_ids[1]
      else null
    end,
    public.owner_crm_owner_email_verified_at(owner_members.profile_ids[1]),
    consent.id,
    consent.granted,
    consent.occurred_at,
    consent.policy_version
  from workspace_page
  -- Candidate membership is always constrained to the current workspace.
  left join lateral (
    select array_agg(member.profile_id order by member.profile_id) as profile_ids
    from (
      select wm.profile_id
      from public.workspace_members wm
      where wm.workspace_id = workspace_page.id
        and wm.role = 'owner'
      order by wm.profile_id
      limit 2
    ) member
  ) owner_members on true
  -- Profile data is reachable only from the current workspace's sole owner.
  left join public.profiles owner_profile
    on cardinality(owner_members.profile_ids) = 1
    and owner_profile.id = owner_members.profile_ids[1]
  left join lateral (
    select e.id,e.granted,e.occurred_at,e.policy_version
    from public.workspace_marketing_consent_events e
    where e.workspace_id=workspace_page.id and e.profile_id=owner_members.profile_ids[1] and cardinality(owner_members.profile_ids)=1
    order by e.occurred_at desc,e.id desc limit 1
  ) consent on true
  -- A person attached to another workspace is not silently assigned to one.
  left join lateral (
    select count(*)::integer as workspace_count
    from public.workspace_members owner_workspace_members
    where owner_workspace_members.profile_id = owner_members.profile_ids[1]
      and exists (
        select 1
        from public.workspace_members scoped_owner_membership
        where scoped_owner_membership.workspace_id = workspace_page.id
          and scoped_owner_membership.profile_id = owner_workspace_members.profile_id
          and scoped_owner_membership.role = 'owner'
      )
  ) owner_workspace_count on cardinality(owner_members.profile_ids) = 1
  order by workspace_page.id asc;
end;
$$;

revoke all on function public.owner_crm_customer_snapshot_page(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.owner_crm_customer_snapshot_page(uuid, integer)
  to service_role;

-- Explicit marketing consent facts only. No delivery or eligibility is inferred here.

comment on function public.owner_crm_customer_snapshot_page(uuid, integer) is
  'Service-role-only bounded read projection for the signed owner CRM snapshot. It never changes billing, access, delivery, CRM, or provider state.';

commit;
