-- Bind a publish-time compliance result to the exact immutable Meta subject.
-- The service-only RPC owns the update so report IDs can never be rebound
-- across workspaces or campaigns, including under concurrent publish clicks.
create or replace function public.adstudio_bind_publish_compliance(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_report_id uuid,
  p_subject_hash text,
  p_status text,
  p_issues_json jsonb,
  p_checked_at timestamptz
)
returns table (
  report_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  subject_hash text,
  status text,
  issues_json jsonb,
  checked_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bound public.adstudio_compliance_reports%rowtype;
begin
  if p_workspace_id is null or p_campaign_id is null or p_report_id is null then
    raise exception 'Publish compliance ownership is required' using errcode = '22023';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Publish compliance subject must be a SHA-256 hash' using errcode = '22023';
  end if;
  if p_status not in ('approved', 'needs_review', 'blocked') then
    raise exception 'Invalid publish compliance status' using errcode = '22023';
  end if;
  if p_issues_json is null or jsonb_typeof(p_issues_json) <> 'array' or p_checked_at is null then
    raise exception 'Publish compliance evidence is incomplete' using errcode = '22023';
  end if;

  -- Serialize bindings for one report. Repeating the same binding is
  -- idempotent; a later different immutable subject deliberately makes an old
  -- plan stale and therefore unable to pass the strict equality gate.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select report.*
  into bound
  from public.adstudio_compliance_reports as report
  where report.id = p_report_id
    and report.workspace_id = p_workspace_id
    and report.campaign_id = p_campaign_id
  for update;

  if not found then
    raise exception 'Publish compliance report is outside the campaign workspace'
      using errcode = '42501';
  end if;

  update public.adstudio_compliance_reports as report
  set subject_hash = p_subject_hash,
      status = p_status,
      issues_json = p_issues_json,
      checked_at = p_checked_at
  where report.id = p_report_id
    and report.workspace_id = p_workspace_id
    and report.campaign_id = p_campaign_id
  returning report.* into bound;

  if bound.subject_hash is distinct from p_subject_hash then
    raise exception 'Publish compliance binding failed closed' using errcode = '40001';
  end if;

  return query select
    bound.id,
    bound.workspace_id,
    bound.campaign_id,
    bound.subject_hash,
    bound.status,
    bound.issues_json,
    bound.checked_at;
end;
$$;

revoke all on function public.adstudio_bind_publish_compliance(
  uuid, uuid, uuid, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.adstudio_bind_publish_compliance(
  uuid, uuid, uuid, text, text, jsonb, timestamptz
) to service_role;
