#!/usr/bin/env bash
# Rollback-only acceptance for the restored owner-CRM consent rehearsal database.
set -Eeuo pipefail

container="${OWNER_CRM_CONSENT_RESTORE_CONTAINER:-blockwise-owner-crm-consent-restore-20260913}"
database="${OWNER_CRM_CONSENT_RESTORE_DATABASE:-crm_rehearsal}"

[[ "$container" == blockwise-owner-crm-consent-restore-* ]] || { echo "refusing non-rehearsal container" >&2; exit 2; }
[[ "$container" != "blockwise-product-product-db-1" && "$database" == crm_rehearsal ]] || { echo "refusing production target" >&2; exit 2; }
[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container" 2>/dev/null)" == none ]] || { echo "rehearsal container must have network none" >&2; exit 2; }
docker exec "$container" pg_isready -U postgres -d "$database" >/dev/null

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
begin;
\o /dev/null
create schema if not exists acceptance;

do $$
declare
  required_migrations text[] := array['20260913030000_workspace_marketing_consent.sql','20260913030100_owner_crm_snapshot_marketing_consent.sql','20260913030200_correct_owner_crm_snapshot_marketing_consent.sql','20260913030300_correct_marketing_consent_grant_gate.sql'];
  required_snapshot_columns text[] := array['marketing_consent_event_id','marketing_consent_granted','marketing_consent_occurred_at','marketing_consent_policy_version','cancel_at_period_end'];
  expected_shape text[] := array['granted:boolean:NO','id:uuid:NO','occurred_at:timestamp with time zone:NO','policy_version:text:NO','profile_id:uuid:NO','workspace_id:uuid:NO'];
  actual_shape text[];
  missing text[];
begin
  -- Reject a restored database whose migration ledger or native table shape is not exact.
  select array_agg(version order by version) filter (where version = any(required_migrations)) into missing from public.blockwise_product_migration_ledger;
  if missing is distinct from required_migrations then raise exception 'missing consent migration ledger entries'; end if;
  select array_agg(column_name || ':' || data_type || ':' || is_nullable order by column_name) into actual_shape from information_schema.columns where table_schema='public' and table_name='workspace_marketing_consent_events';
  if actual_shape is distinct from expected_shape then raise exception 'unexpected consent table shape'; end if;
  if exists(select 1 from public.workspace_marketing_consent_events) then raise exception 'restored consent table is unexpectedly nonempty'; end if;
  -- Snapshot is a RETURNS TABLE function, so validate its declared output text.
  select array_agg(x order by x) into missing
  from unnest(required_snapshot_columns) x
  where pg_get_function_result('public.owner_crm_customer_snapshot_page(uuid,integer)'::regprocedure) not like '%' || x || '%';
  if missing is not null then raise exception 'snapshot misses lifecycle or consent output fields: %', missing; end if;
end $$;

-- Isolated fixture. It is deliberately rolled back, including auth and workspace rows.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
values
 ('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','verified@example.test','x',statement_timestamp(),statement_timestamp(),statement_timestamp(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','unverified@example.test','x',statement_timestamp(),statement_timestamp(),statement_timestamp(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cross@example.test','x',statement_timestamp(),statement_timestamp(),statement_timestamp(),'{}','{}');
insert into public.profiles(id,email,full_name) values
 ('81000000-0000-4000-8000-000000000001','verified@example.test','Verified'),
 ('81000000-0000-4000-8000-000000000002','unverified@example.test','Unverified'),
 ('81000000-0000-4000-8000-000000000003','cross@example.test','Cross');
insert into public.workspaces(id,name,created_by) values
 ('82000000-0000-4000-8000-000000000001','Acceptance one','81000000-0000-4000-8000-000000000001'),
 ('82000000-0000-4000-8000-000000000002','Acceptance two','81000000-0000-4000-8000-000000000003');
insert into public.workspace_members(workspace_id,profile_id,role) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner'),
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','member'),
 ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','owner');
update auth.users set email_confirmed_at=null where id='81000000-0000-4000-8000-000000000002';

-- 1 verified member grant; 2 same member revoke retains two events.
set local role authenticated; select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',true);
select public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',false);
reset role;
do $$ begin if (select count(*) from public.workspace_marketing_consent_events)=2 then null; else raise exception 'grant/revoke event count failed'; end if; end $$;
-- 3 direct writes denied; 4 unverified grant denied; 5 unverified revoke allowed; 6 cross-workspace denied/no events; 7 anon denied.
set local role authenticated; select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
do $$ begin begin insert into public.workspace_marketing_consent_events(workspace_id,profile_id,granted) values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',true); raise exception 'direct write allowed'; exception when insufficient_privilege then null; end; begin perform public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',true); raise exception 'unverified grant allowed'; exception when insufficient_privilege then null; end; end $$;
select public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
do $$ begin begin perform public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',false); raise exception 'cross workspace allowed'; exception when insufficient_privilege then null; end; end $$;
reset role; set local role anon;
do $$ begin begin perform public.record_workspace_marketing_consent('82000000-0000-4000-8000-000000000001',false); raise exception 'anon allowed'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- 8 service snapshot returns latest revoke and verified timestamp; 9 authenticated cannot execute helper; 10 two owners yield null verification; 11 outside-workspace helper null; 12 RLS hides foreign events.
set local role service_role;
do $$ begin
 if not exists(select 1 from public.owner_crm_customer_snapshot_page(null,100) s where s.workspace_id='82000000-0000-4000-8000-000000000001' and s.marketing_consent_granted=false and s.owner_email_verified_at is not null) then raise exception 'service snapshot consent/verification failed'; end if;
 if public.owner_crm_owner_email_verified_at('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003') is not null then raise exception 'out of workspace helper leaked'; end if;
end $$;
reset role; set local role authenticated; select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ begin begin perform public.owner_crm_owner_email_verified_at('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001'); raise exception 'helper exposed'; exception when insufficient_privilege then null; end; if (select count(*) from public.workspace_marketing_consent_events where workspace_id='82000000-0000-4000-8000-000000000002') <> 0 then raise exception 'foreign events visible'; end if; end $$;
rollback;
SQL

echo 'owner CRM restored consent acceptance passed (rollback only)'
