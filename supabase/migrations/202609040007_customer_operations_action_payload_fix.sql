-- Forward-only repair for the action contract. PostgreSQL does not provide
-- jsonb_object_length on all supported versions; count object keys instead.
create or replace function public.ops_action_payload_is_valid(p_action_type text, p_payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_allowed text[];
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or not public.ops_payload_is_safe(p_payload) then return false; end if;
  v_allowed := case p_action_type
    when 'team_invite' then array['email', 'role']
    when 'team_role_change' then array['role']
    when 'consent_grant' then array['topic']
    when 'consent_withdraw' then array['topic']
    when 'suppression_add' then array['reason']
    when 'suppression_remove' then array['reason']
    when 'enquiry_assign' then array['assigneeProfileId']
    when 'enquiry_reply' then array['body']
    when 'booking_reschedule' then array['scheduledStartAt', 'scheduledEndAt']
    when 'billing_cancel_at_period_end' then array['cancelAtPeriodEnd']
    else array[]::text[]
  end;
  for v_key in select jsonb_object_keys(p_payload) loop
    if not (v_key = any(v_allowed)) then return false; end if;
  end loop;
  if exists (select 1 from jsonb_each(p_payload) where jsonb_typeof(value) not in ('string', 'boolean', 'null')) then return false; end if;
  if p_action_type = 'team_invite' then
    return nullif(btrim(p_payload ->> 'email'), '') is not null
      and char_length(p_payload ->> 'email') <= 320
      and position('@' in p_payload ->> 'email') > 1
      and p_payload ->> 'role' in ('admin', 'member', 'viewer');
  elsif p_action_type = 'team_role_change' then
    return p_payload ->> 'role' in ('admin', 'member', 'viewer');
  elsif p_action_type = 'consent_grant' then
    return char_length(coalesce(p_payload ->> 'topic', '')) between 1 and 128;
  elsif p_action_type = 'consent_withdraw' then
    return p_payload ->> 'topic' is null or char_length(p_payload ->> 'topic') between 1 and 128;
  elsif p_action_type in ('suppression_add', 'suppression_remove') then
    return char_length(coalesce(p_payload ->> 'reason', '')) between 1 and 500;
  elsif p_action_type = 'enquiry_assign' then
    return p_payload ? 'assigneeProfileId' and (p_payload -> 'assigneeProfileId' = 'null'::jsonb or (p_payload ->> 'assigneeProfileId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  elsif p_action_type = 'enquiry_reply' then
    return char_length(coalesce(p_payload ->> 'body', '')) between 1 and 4000;
  elsif p_action_type = 'booking_reschedule' then
    return (p_payload ->> 'scheduledStartAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      and (p_payload ->> 'scheduledEndAt' is null or (p_payload ->> 'scheduledEndAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$');
  elsif p_action_type = 'billing_cancel_at_period_end' then
    return jsonb_typeof(p_payload -> 'cancelAtPeriodEnd') = 'boolean';
  end if;
  return (select count(*) from jsonb_object_keys(p_payload)) = 0;
end;
$$;

revoke all on function public.ops_action_payload_is_valid(text,jsonb) from public, anon, authenticated, service_role;
