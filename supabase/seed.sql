do $$
declare
  operator_user_id uuid;
  operator_email text := 'steven@blockwise.sale';
  growth_plan_id uuid;
  demo_workspace_id uuid := '00000000-0000-4000-8000-000000000001';
  demo_campaign_id uuid := '00000000-0000-4000-8000-000000000101';
begin
  select id into operator_user_id
  from auth.users
  where lower(email) = operator_email
  limit 1;

  if operator_user_id is null then
    raise notice 'Create the Supabase auth user % before running the Blockwise demo seed.', operator_email;
    return;
  end if;

  insert into public.profiles (id, email, full_name, is_operator)
  select id, email, coalesce(raw_user_meta_data ->> 'full_name', 'Steven Shelley'), true
  from auth.users
  where id = operator_user_id
  on conflict (id) do update set is_operator = true;

  select id into growth_plan_id from public.workspace_plans where key = 'growth';

  insert into public.workspaces (id, name, mode, plan_id, region, managed_service_enabled, created_by)
  values (demo_workspace_id, 'Northstar Realty', 'self_serve', growth_plan_id, 'AU', true, operator_user_id)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (demo_workspace_id, operator_user_id, 'operator')
  on conflict (workspace_id, profile_id) do update set role = 'operator';

  insert into public.provider_connections (
    workspace_id, provider, status, scopes, external_account_id, external_account_name, last_sync_at, created_by
  )
  values
    (demo_workspace_id, 'meta', 'connected', array['ads_read', 'leads_retrieval'], 'act_demo_meta', 'Northstar Meta Ads', now(), operator_user_id),
    (demo_workspace_id, 'google', 'needs_attention', array['adwords'], 'customers/demo_google', 'Northstar Google Ads', now() - interval '18 hours', operator_user_id)
  on conflict do nothing;

  insert into public.campaigns (id, workspace_id, provider, name, status, draft_payload, created_by)
  values (
    demo_campaign_id,
    demo_workspace_id,
    'meta',
    'Suburb Appraisal Pulse',
    'draft',
    '{"objective":"LEAD_GENERATION","headline":"What changed in your suburb this month?","callToAction":"Get report"}',
    operator_user_id
  )
  on conflict (id) do nothing;

  insert into public.approval_requests (workspace_id, target_type, target_id, status, requested_by, risk_summary)
  values (demo_workspace_id, 'campaign', demo_campaign_id, 'requested', operator_user_id, 'Publishing requires human approval.')
  on conflict do nothing;

  insert into public.leads (workspace_id, provider, external_id, email, phone, full_name, suburb, raw_payload)
  values
    (demo_workspace_id, 'meta', 'meta_lead_001', 'amelia@example.com', '0400 111 222', 'Amelia Hart', 'Subiaco', '{"source":"demo"}'),
    (demo_workspace_id, 'google', 'google_lead_002', 'daniel@example.com', '0400 333 444', 'Daniel Ng', 'Leederville', '{"source":"demo"}')
  on conflict do nothing;

  delete from public.reporting_snapshots
  where workspace_id = demo_workspace_id
    and provider in ('meta', 'google')
    and date_range = daterange('2026-04-26', '2026-05-26', '[]');

  insert into public.reporting_snapshots (workspace_id, provider, date_range, metrics)
  values
    (demo_workspace_id, 'meta', daterange('2026-04-26', '2026-05-26', '[]'), '{"spendAud":1840,"leads":92,"cplAud":20}'),
    (demo_workspace_id, 'google', daterange('2026-04-26', '2026-05-26', '[]'), '{"spendAud":1245,"leads":30,"cplAud":41.5}');
end $$;
