-- Authoritative optimistic-concurrency versions for every Frank customer-ops
-- target. These are source-row versions, not worker-generated timestamps or
-- provider identifiers. A newly-created source row starts at version 1 and
-- every source-row update increments it before the row is observed.
begin;

alter table public.workspaces
  add column if not exists ops_version bigint not null default 1;
alter table public.workspace_members
  add column if not exists ops_version bigint not null default 1;
alter table public.workspace_invitations
  add column if not exists ops_version bigint not null default 1;
alter table public.billing_offer_acceptances
  add column if not exists ops_version bigint not null default 1;
alter table public.audit_logs
  add column if not exists ops_version bigint not null default 1;
alter table public.ops_enquiry_associations
  add column if not exists ops_version bigint not null default 1;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['workspaces','workspace_members','workspace_invitations','billing_offer_acceptances','audit_logs','ops_enquiry_associations'] loop
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_ops_version_check');
    execute format('alter table public.%I add constraint %I check (ops_version > 0)', v_table, v_table || '_ops_version_check');
  end loop;
end $$;

create or replace function public.ops_bump_target_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.ops_version := old.ops_version + 1;
  elsif new.ops_version is null or new.ops_version < 1 then
    new.ops_version := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists ops_workspace_target_version on public.workspaces;
create trigger ops_workspace_target_version before update on public.workspaces
  for each row execute function public.ops_bump_target_version();
drop trigger if exists ops_member_target_version on public.workspace_members;
create trigger ops_member_target_version before update on public.workspace_members
  for each row execute function public.ops_bump_target_version();
drop trigger if exists ops_invitation_target_version on public.workspace_invitations;
create trigger ops_invitation_target_version before update on public.workspace_invitations
  for each row execute function public.ops_bump_target_version();
drop trigger if exists ops_billing_target_version on public.billing_offer_acceptances;
create trigger ops_billing_target_version before update on public.billing_offer_acceptances
  for each row execute function public.ops_bump_target_version();
drop trigger if exists ops_audit_target_version on public.audit_logs;
create trigger ops_audit_target_version before update on public.audit_logs
  for each row execute function public.ops_bump_target_version();
-- #435 owns the enquiry-assignment trigger. Do not install a second increment
-- trigger here: two BEFORE UPDATE version bumps would skip versions and break
-- Frank's exact CAS contract.

revoke all on function public.ops_bump_target_version() from public, anon, authenticated, service_role;

-- Keep the version visible in the service-only customer summary used by the
-- resolver. CREATE OR REPLACE may append a view column but may not reorder it.
create or replace view public.ops_customer_summary as
select
  w.id as workspace_id, w.name as workspace_name, w.mode, w.region,
  w.country_code, w.managed_service_enabled, w.billing_access_state,
  w.stripe_subscription_status, w.stripe_latest_invoice_status,
  w.created_at, w.updated_at,
  owner_profile.id as owner_profile_id, owner_profile.email as owner_email,
  owner_profile.full_name as owner_name,
  activation.email_verified_at, activation.website_submitted_at,
  activation.brand_pack_approved_at, activation.first_ad_pack_generated_at,
  activation.meta_connected_at, activation.checkout_completed_at,
  activation.onboarding_completed_at,
  booking.status as booking_status,
  booking.scheduled_start_at as booking_scheduled_start_at,
  w.ops_version
from public.workspaces w
left join lateral (
  select p.id, p.email, p.full_name
  from public.workspace_members wm
  join public.profiles p on p.id = wm.profile_id
  where wm.workspace_id = w.id and wm.role = 'owner'
  order by wm.created_at asc limit 1
) owner_profile on true
left join public.customer_activations activation on activation.workspace_id = w.id
left join lateral (
  select b.status, b.scheduled_start_at
  from public.workspace_onboarding_bookings b
  where b.workspace_id = w.id
  order by b.updated_at desc, b.created_at desc limit 1
) booking on true;
revoke all on public.ops_customer_summary from public, anon, authenticated;
grant select on public.ops_customer_summary to service_role;

-- Replace the completion resolver with action-target versions. Every row that
-- Frank can target has a positive source-row version; rows without a legal
-- source row remain absent and therefore correctly keep controls disabled.
create or replace function public.resolve_ops_frank_bundle() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_revision text := 'unbound';
  v_workspaces jsonb; v_workspace_ids text[]; v_receipts text[];
  v_members jsonb; v_bookings jsonb; v_billing jsonb; v_email jsonb;
  v_flows jsonb; v_mautic jsonb; v_enquiries jsonb; v_activity jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.workspace_id,'workspace_id',s.workspace_id,'name',s.workspace_name,
    'mode',s.mode,'region',s.region,'country_code',s.country_code,
    'managed_service_enabled',s.managed_service_enabled,
    'billing_access_state',s.billing_access_state,
    'stripe_subscription_status',s.stripe_subscription_status,
    'stripe_latest_invoice_status',s.stripe_latest_invoice_status,
    'created_at',s.created_at,'updated_at',s.updated_at,'email',s.owner_email,
    'display_name',s.owner_name,'ops_version',s.ops_version)
    order by s.workspace_id),'[]'::jsonb),
    coalesce(array_agg(s.workspace_id::text order by s.workspace_id),'{}'::text[])
    into v_workspaces,v_workspace_ids from public.ops_customer_summary s;

  select coalesce(array_agg(r.receipt order by r.receipt), '{}'::text[]) into v_receipts
  from (
    select distinct 'receipt:ops/source-'||lower(left(regexp_replace(o.source_event_id,'[^A-Za-z0-9_-]','','g'),96)) as receipt
      from public.ops_projection_outbox o where o.workspace_id=any(v_workspace_ids::uuid[])
    union select distinct 'receipt:ops/snapshot-'||lower(left(regexp_replace(s.source_event_id,'[^A-Za-z0-9_-]','','g'),96))
      from public.ops_provider_snapshots s where s.workspace_id=any(v_workspace_ids::uuid[])
    union select distinct 'receipt:ops/global-'||g.id::text from public.ops_global_projection_outbox g
  ) r;

  select coalesce(jsonb_agg(x.item order by x.sort_at), '[]'::jsonb) into v_members from (
    select jsonb_build_object('id','member:'||wm.workspace_id::text||':'||wm.profile_id::text,
      'customer_id',wm.workspace_id,'workspace_id',wm.workspace_id,'profile_id',p.id,
      'email',p.email,'full_name',p.full_name,'role',wm.role,'status','active',
      'created_at',wm.created_at,'ops_version',wm.ops_version) item, wm.created_at sort_at
      from public.workspace_members wm join public.profiles p on p.id=wm.profile_id
      where wm.workspace_id=any(v_workspace_ids::uuid[])
    union all
    select jsonb_build_object('id',i.id,'customer_id',i.workspace_id,'workspace_id',i.workspace_id,
      'email',i.email,'role',i.role,'status',i.status,'created_at',i.created_at,
      'updated_at',i.updated_at,'ops_version',i.ops_version) item, i.created_at sort_at
      from public.workspace_invitations i
      where i.workspace_id=any(v_workspace_ids::uuid[]) and i.status='pending'
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'customer_id',b.workspace_id,
    'workspace_id',b.workspace_id,'booking_ref',b.id::text,'status',b.status,
    'provider',b.provider,'scheduled_start_at',b.scheduled_start_at,
    'scheduled_end_at',b.scheduled_end_at,'booked_at',b.booked_at,
    'cancelled_at',b.cancelled_at,'completed_at',b.completed_at,
    'created_at',b.created_at,'updated_at',b.updated_at,
    'ops_version',(select max(o.source_version) from public.ops_projection_outbox o
      where o.workspace_id=b.workspace_id and o.aggregate_type='support' and o.aggregate_id=b.id::text))
    order by b.updated_at desc),'[]'::jsonb) into v_bookings
    from public.workspace_onboarding_bookings b where b.workspace_id=any(v_workspace_ids::uuid[]);

  select coalesce(jsonb_agg(x.item order by x.sort_at desc),'[]'::jsonb) into v_billing from (
    select jsonb_build_object('id',s.workspace_id,'customer_id',s.workspace_id,'workspace_id',s.workspace_id,
      'status',coalesce(s.billing_access_state,'setup_needed'),'plan',s.billing_access_state,
      'stripe_subscription_status',s.stripe_subscription_status,
      'stripe_latest_invoice_status',s.stripe_latest_invoice_status,
      'updated_at',s.updated_at,'ops_version',s.ops_version) item, s.updated_at sort_at
      from public.ops_customer_summary s where s.workspace_id=any(v_workspace_ids::uuid[])
    union all
    select jsonb_build_object('id',a.id,'customer_id',a.workspace_id,'workspace_id',a.workspace_id,
      'status','customer','plan',a.offer_key,'currency',a.currency,
      'first_invoice_amount',a.first_invoice_amount,'renewal_amount',a.renewal_amount,
      'accepted_at',a.accepted_at,'offer_key',a.offer_key,'offer_version',a.offer_version,
      'ops_version',a.ops_version) item, a.accepted_at sort_at
      from public.billing_offer_acceptances a where a.workspace_id=any(v_workspace_ids::uuid[])
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text||':'||e.workspace_id::text,
    'customer_id',e.workspace_id,'workspace_id',e.workspace_id,'template',e.template_id,
    'subject',left(coalesce(e.payload->>'subject',''),512),'status',e.status,
    'delivery_status',e.status,'created_at',e.created_at,'sent_at',e.sent_at,
    'updated_at',coalesce(e.sent_at,e.created_at),'failure_reason',public.redact_ops_text(e.last_error),
    'provider','stalwart','kind',e.message_type,'suppression_state',case when e.status='suppressed' then 'suppressed' else 'allowed' end,
    'provider_record_suffix',case when e.provider_message_id is null then null else '****'||right(e.provider_message_id,4) end,
    'ops_version',(select max(o.source_version) from public.ops_projection_outbox o where o.workspace_id=e.workspace_id))
    order by e.created_at desc),'[]'::jsonb) into v_email from public.email_outbox e
    where e.workspace_id is not null and e.workspace_id=any(v_workspace_ids::uuid[]);

  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,
    'workspace_id',s.workspace_id,'name','Mautic '||coalesce(s.stage,'lifecycle'),
    'type','lifecycle','status',s.status,'stage',s.stage,
    'campaign',coalesce(s.safe_data->>'campaign_status','not_configured'),
    'enrolled_at',s.created_at,'last_activity_at',s.last_activity_at,
    'updated_at',s.updated_at,'snapshot_kind',s.snapshot_kind,
    'source_event_id',s.source_event_id,'source_version',s.source_version,
    'ops_version',s.source_version) order by s.updated_at desc),'[]'::jsonb) into v_flows
    from public.ops_provider_snapshots s where s.provider='mautic'
      and s.snapshot_kind in ('flow','lifecycle') and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'customer_id',s.workspace_id,
    'workspace_id',s.workspace_id,'stage',s.stage,'status',s.status,
    'provider_record_suffix',s.provider_record_suffix,'snapshot_kind',s.snapshot_kind,
    'source_event_id',s.source_event_id,'source_version',s.source_version,
    'ops_version',s.source_version,'updated_at',s.updated_at) order by s.updated_at desc),'[]'::jsonb) into v_mautic
    from public.ops_provider_snapshots s where s.provider='mautic'
      and s.snapshot_kind='lifecycle' and s.workspace_id=any(v_workspace_ids::uuid[]);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'customer_id',e.workspace_id,
    'workspace_id',e.workspace_id,'subject',e.subject,'status',e.status,
    'enquiry_type',e.enquiry_type,'requester_email',e.requester_email,
    'requester_name',e.requester_name,'source_system',e.source_system,
    'created_at',e.created_at,'updated_at',e.updated_at,'ops_version',e.ops_version)
    order by e.updated_at desc),'[]'::jsonb) into v_enquiries from public.ops_enquiry_associations e
    where e.workspace_id=any(v_workspace_ids::uuid[]) or e.workspace_id is null;
  select coalesce(jsonb_agg(x.item order by x.sort_at desc),'[]'::jsonb) into v_activity from (
    -- Session revoke targets are member profile IDs, so publish the member's
    -- authoritative version as the session row. Audit rows remain separate
    -- activity evidence and never masquerade as a mutable session target.
    select jsonb_build_object('id',wm.profile_id,'customer_id',wm.workspace_id,
      'workspace_id',wm.workspace_id,'kind','session','title','Active sessions',
      'occurred_at',wm.updated_at,'created_at',wm.created_at,
      'ops_version',wm.ops_version) item, wm.updated_at sort_at
      from public.workspace_members wm where wm.workspace_id=any(v_workspace_ids::uuid[])
    union all
    select jsonb_build_object('id',a.id,'customer_id',a.workspace_id,
      'workspace_id',a.workspace_id,'kind',a.target_type,'title',a.action,
      'occurred_at',a.created_at,'created_at',a.created_at,'ops_version',a.ops_version) item, a.created_at sort_at
      from public.audit_logs a where a.workspace_id=any(v_workspace_ids::uuid[])
  ) x;

  return jsonb_build_object('project_id','blockwise','source_revision',v_revision,
    'source_receipt_ids',to_jsonb(v_receipts),'workspace_ids',to_jsonb(v_workspace_ids),
    'fresh_until',(now()+interval '15 minutes'),'projections',jsonb_build_object(
      'customers',v_workspaces,'email',v_email,'flows',v_flows,'mautic',v_mautic,
      'enquiries',v_enquiries,'bookings',v_bookings,'billing',v_billing,
      'activity',v_activity,'members',v_members));
end; $$;
revoke all on function public.resolve_ops_frank_bundle() from public, anon, authenticated;
grant execute on function public.resolve_ops_frank_bundle() to service_role;

-- The earlier action-stack binding checked ownership but did not compare the
-- queued version with the locked source row. Replace it after every versioned
-- source table exists. Unknown/future targets fail closed.
create or replace function public.ops_action_target_binding()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_current bigint;
begin
  if new.action_type = 'team_invite' then
    if new.target_type <> 'workspace' or new.target_id <> new.workspace_id then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select w.ops_version into v_current from public.workspaces w where w.id=new.workspace_id for update;
  elsif new.action_type = 'billing_reconcile' then
    if new.target_type <> 'billing' or new.target_id <> new.workspace_id then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select w.ops_version into v_current from public.workspaces w where w.id=new.workspace_id for update;
  elsif new.action_type in ('team_resend','team_cancel') then
    if new.target_type <> 'invitation' then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select i.ops_version into v_current from public.workspace_invitations i
      where i.id=new.target_id and i.workspace_id=new.workspace_id for update;
  elsif new.action_type = 'session_revoke' then
    if new.target_type <> 'session' then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    if not exists (select 1 from auth.users u where u.id=new.target_id) then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select wm.ops_version into v_current from public.workspace_members wm
      where wm.workspace_id=new.workspace_id and wm.profile_id=new.target_id for update;
  elsif new.action_type = 'enquiry_assign' then
    if new.target_type <> 'enquiry' then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select e.ops_version into v_current from public.ops_enquiry_associations e
      where e.id=new.target_id
        and (e.workspace_id=new.workspace_id or e.workspace_id is null) for update;
  elsif new.action_type in ('team_role_change','team_suspend','team_reactivate',
      'consent_grant','consent_withdraw','consent_unsubscribe','suppression_add','suppression_remove') then
    if new.target_type <> 'profile' then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select wm.ops_version into v_current from public.workspace_members wm
      where wm.workspace_id=new.workspace_id and wm.profile_id=new.target_id for update;
  elsif new.action_type in ('billing_cancel_at_period_end','billing_portal_link') then
    if new.target_type <> 'billing' or new.target_id <> new.workspace_id then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select w.ops_version into v_current from public.workspaces w where w.id=new.workspace_id for update;
  elsif new.action_type in ('enquiry_close','enquiry_reply') then
    if new.target_type <> 'enquiry' then
      raise exception 'operations action target is not owned by workspace' using errcode='42501';
    end if;
    select e.ops_version into v_current from public.ops_enquiry_associations e
      where e.id=new.target_id and e.workspace_id=new.workspace_id for update;
  else
    raise exception 'operations action target is not owned by workspace' using errcode='42501';
  end if;
  if v_current is null then
    raise exception 'operations action target is not owned by workspace' using errcode='42501';
  end if;
  if new.expected_version <> v_current then
    raise exception 'operations action target version is stale' using errcode='40001';
  end if;
  return new;
end;
$$;

-- Global website enquiries become tenant-scoped only at the explicit human
-- association step. The action remains workspace-owned, but its source row
-- may still have workspace_id NULL until this CAS succeeds.
create or replace function public.assign_ops_enquiry(
  p_workspace_id uuid, p_enquiry_id uuid, p_assignee_profile_id uuid,
  p_expected_version bigint, p_actor_profile_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  if p_workspace_id is null or p_enquiry_id is null or p_expected_version is null or p_expected_version < 1 or p_actor_profile_id is null then
    raise exception 'invalid enquiry assignment identity' using errcode = '22023';
  end if;
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not found then
    raise exception 'workspace_not_found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.profiles
      where id=p_actor_profile_id and is_operator=true and operator_role in ('owner','support')
  ) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if p_assignee_profile_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id=p_workspace_id and profile_id=p_assignee_profile_id
  ) then
    raise exception 'enquiry assignee is not a workspace member' using errcode = '42501';
  end if;
  update public.ops_enquiry_associations
    set workspace_id=p_workspace_id, assignee_profile_id=p_assignee_profile_id
    where id=p_enquiry_id and (workspace_id=p_workspace_id or workspace_id is null)
      and ops_version=p_expected_version;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into public.audit_logs (workspace_id, actor_profile_id, action, target_type, target_id, metadata)
      values (p_workspace_id, p_actor_profile_id, 'ops.enquiry_assigned', 'enquiry', p_enquiry_id,
        jsonb_build_object('assigneeProfileId',p_assignee_profile_id,'expectedVersion',p_expected_version));
  end if;
  return v_updated = 1;
end;
$$;
revoke all on function public.ops_action_target_binding() from public, anon, authenticated, service_role;
revoke all on function public.assign_ops_enquiry(uuid,uuid,uuid,bigint,uuid) from public, anon, authenticated;
grant execute on function public.assign_ops_enquiry(uuid,uuid,uuid,bigint,uuid) to service_role;

commit;
