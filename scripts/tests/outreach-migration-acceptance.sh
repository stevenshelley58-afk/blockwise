#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
migration="$root/supabase/migrations/20260907010000_postcode_outreach_drafts.sql"
container="blockwise-outreach-migration-test-$$"
password="migration-test-$RANDOM-$RANDOM"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
[[ -f "$migration" ]] || exit 2
docker run -d --rm --name "$container" --network none -e POSTGRES_PASSWORD="$password" "${POSTGRES_TEST_IMAGE:-postgres:17.6-alpine}" >/dev/null
for _ in $(seq 1 30); do docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
SQL
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration"
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$root/infra/product/post-migrate-api-grants.sql"
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
do $$ declare r text; acl text[]; begin
  foreach r in array array['outreach_area_snapshots','outreach_prospects','outreach_campaign_drafts'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=r and c.relrowsecurity) then raise exception 'RLS missing on %',r; end if;
    select c.relacl into acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=r;
    if exists (select 1 from unnest(coalesce(acl,array[]::text[])) x where x like 'anon=%' or x like 'authenticated=%') then raise exception 'public ACL remains on %',r; end if;
  end loop;
end $$;
set role service_role;
select public.outreach_import_draft(
'{"postcode":"6000","coverage_label":"Perth","snapshot_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","suburbs":["Perth"],"scan_status":"recent_ads_observed","scan_id":"scan-1","scanned_at":"2026-09-07T08:00:00Z","scan_completed":true,"scope_verified":true,"scan_source":"fixture","observed_ad_count":1,"ad_examples":[],"source_rights_confirmed":true}'::jsonb,
'{"external_ref":"fixture-1","agent_name":"Test Agent","agency_name":"Test Agency","recorded_agent_location":"Perth","postcode":"6000","agent_page_url":"https://example.invalid/agent","agency_page_url":"https://example.invalid/agency","contact_email":"test@example.invalid","contact_provenance":{"source":"fixture"},"advertising_evidence":{"fixture":true},"prospect_ad_examples":[],"consent_basis":"fixture","consent_recorded_at":null,"suppression_clear":true,"source_rights_confirmed":true,"scope_verified":true,"data_fresh_at":"2026-09-07T08:00:00Z","is_demo":false}'::jsonb,
'{"idempotency_key":"import-1","import_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","report_url":"https://blockwise.sale/ad-reports/fixture-token","report_token_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","email_subject":"Subject","email_html":"<p>Body</p>","email_text":"Body","email_template_id":"fixture","email_template_version":1,"evidence_segment":"recent_ads_observed","public_report":{"coverage_label":"Perth","items":[]},"status":"draft","follow_up_count":0}'::jsonb
);
select public.outreach_import_draft(
'{"postcode":"6000","coverage_label":"Perth","snapshot_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","suburbs":["Perth"],"scan_status":"recent_ads_observed","scan_id":"scan-1","scanned_at":"2026-09-07T08:00:00Z","scan_completed":true,"scope_verified":true,"scan_source":"fixture","observed_ad_count":1,"ad_examples":[],"source_rights_confirmed":true}'::jsonb,
'{"external_ref":"fixture-1","agent_name":"Test Agent","agency_name":"Test Agency","recorded_agent_location":"Perth","postcode":"6000","agent_page_url":"https://example.invalid/agent","agency_page_url":"https://example.invalid/agency","contact_email":"test@example.invalid","contact_provenance":{"source":"fixture"},"advertising_evidence":{"fixture":true},"prospect_ad_examples":[],"consent_basis":"fixture","consent_recorded_at":null,"suppression_clear":true,"source_rights_confirmed":true,"scope_verified":true,"data_fresh_at":"2026-09-07T08:00:00Z","is_demo":false}'::jsonb,
'{"idempotency_key":"import-1","import_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","report_url":"https://blockwise.sale/ad-reports/fixture-token","report_token_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","email_subject":"Subject","email_html":"<p>Body</p>","email_text":"Body","email_template_id":"fixture","email_template_version":1,"evidence_segment":"recent_ads_observed","public_report":{"coverage_label":"Perth","items":[]},"status":"draft","follow_up_count":0}'::jsonb
) -> 'replayed' as replayed;
do $$ begin if (select count(*) from public.outreach_campaign_drafts where idempotency_key='import-1') <> 1 then raise exception 'retry created duplicate draft'; end if; end $$;
do $$ begin
  perform public.outreach_import_draft(
  '{"postcode":"6000","coverage_label":"Perth","snapshot_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scan_status":"recent_ads_observed","scan_id":"scan-1","scanned_at":"2026-09-07T08:00:00Z","scan_completed":true,"scope_verified":true,"scan_source":"fixture","observed_ad_count":1,"source_rights_confirmed":true}'::jsonb,
  '{"agent_name":"Test Agent","postcode":"6000","contact_email":"test@example.invalid","contact_provenance":{"source":"fixture"},"advertising_evidence":{"fixture":true},"consent_basis":"fixture","suppression_clear":true,"source_rights_confirmed":true,"scope_verified":true,"data_fresh_at":"2026-09-07T08:00:00Z","is_demo":false}'::jsonb,
  '{"idempotency_key":"import-1","import_fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","report_url":"https://blockwise.sale/ad-reports/fixture-token","report_token_hash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","email_subject":"Subject","email_html":"<p>Body</p>","email_text":"Body","email_template_id":"fixture","email_template_version":1,"evidence_segment":"recent_ads_observed","public_report":{}}'::jsonb);
  raise exception 'import conflict unexpectedly succeeded';
exception when others then if sqlerrm <> 'import_conflict' then raise; end if; end $$;
do $$ begin
  perform public.outreach_import_draft(
  '{"postcode":"6000","coverage_label":"Perth","snapshot_fingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","scan_status":"recent_ads_observed","scan_id":"scan-1","scanned_at":"2026-09-07T08:00:00Z","scan_completed":true,"scope_verified":true,"scan_source":"fixture","observed_ad_count":1,"source_rights_confirmed":true}'::jsonb,
  '{"agent_name":"Other Agent","postcode":"6000","contact_email":"other@example.invalid","contact_provenance":{"source":"fixture"},"advertising_evidence":{"fixture":true},"consent_basis":"fixture","suppression_clear":true,"source_rights_confirmed":true,"scope_verified":true,"data_fresh_at":"2026-09-07T08:00:00Z","is_demo":false}'::jsonb,
  '{"idempotency_key":"snapshot-conflict","import_fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","report_url":"https://blockwise.sale/ad-reports/other-token","report_token_hash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","email_subject":"Subject","email_html":"<p>Body</p>","email_text":"Body","email_template_id":"fixture","email_template_version":1,"evidence_segment":"recent_ads_observed","public_report":{}}'::jsonb);
  raise exception 'snapshot conflict unexpectedly succeeded';
exception when others then if sqlerrm <> 'snapshot_conflict' then raise; end if; end $$;
do $$ begin
  perform public.outreach_import_draft(
  '{"postcode":"6000","coverage_label":"Perth","snapshot_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scan_status":"recent_ads_observed","scan_id":"scan-2","scanned_at":"2026-09-07T08:00:00Z","scan_completed":true,"scope_verified":true,"scan_source":"fixture","observed_ad_count":1,"source_rights_confirmed":true}'::jsonb,
  '{"agent_name":"Rollback Agent","postcode":"6000","contact_email":"rollback@example.invalid","contact_provenance":{"source":"fixture"},"advertising_evidence":{"fixture":true},"consent_basis":"fixture","suppression_clear":true,"source_rights_confirmed":true,"scope_verified":true,"data_fresh_at":"2026-09-07T08:00:00Z","is_demo":false}'::jsonb,
  '{"idempotency_key":"invalid-draft","import_fingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","report_url":"https://blockwise.sale/ad-reports/rollback-token","report_token_hash":"9999999999999999999999999999999999999999999999999999999999999999","email_subject":"Subject","email_html":"<p>Body</p>","email_text":"Body","email_template_id":"fixture","email_template_version":1,"evidence_segment":"invalid","public_report":{}}'::jsonb);
  raise exception 'invalid draft unexpectedly succeeded';
exception when others then null; end $$;
do $$ begin if (select count(*) from public.outreach_prospects where contact_email='rollback@example.invalid') <> 0 then raise exception 'failed draft left orphan prospect'; end if; end $$;
do $$ begin
  update public.outreach_campaign_drafts set status='blocked' where id=(select id from public.outreach_campaign_drafts where idempotency_key='import-1');
  begin update public.outreach_campaign_drafts set email_subject='mutated' where id=(select id from public.outreach_campaign_drafts where idempotency_key='import-1'); raise exception 'body mutation unexpectedly succeeded'; exception when others then if sqlerrm='body mutation unexpectedly succeeded' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ begin select public.outreach_import_draft('{}','{}','{}'); raise exception 'anon RPC unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from public.outreach_campaign_drafts; raise exception 'anon read unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated;
do $$ begin select public.outreach_import_draft('{}','{}','{}'); raise exception 'authenticated RPC unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from public.outreach_prospects; raise exception 'authenticated read unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
reset role;
SQL
echo "Outreach migration acceptance passed."
