create extension if not exists pgtap with schema extensions;

begin;
select plan(72);

insert into public.workspaces (id, name, mode, region)
values ('81111111-1111-4111-8111-111111111111', 'Ops contract test', 'self_serve', 'AU')
on conflict (id) do nothing;

-- The bootstrap trigger is expected to enqueue a contact projection. Keep the
-- fixture deterministic for the explicit version-fencing assertions below.
delete from public.ops_projection_outbox
where workspace_id = '81111111-1111-4111-8111-111111111111';

select ok(to_regclass('public.customer_communication_preferences') is not null, 'communication preferences table exists');
select ok(to_regclass('public.ops_projection_outbox') is not null, 'projection outbox exists');
select ok(to_regclass('public.ops_enquiry_associations') is not null, 'explicit enquiry association table exists');
select ok(to_regclass('public.ops_provider_snapshots') is not null, 'provider snapshot table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.ops_projection_outbox'::regclass), 'projection outbox RLS is enabled');
select ok(not has_table_privilege('anon', 'public.ops_projection_outbox', 'SELECT'), 'anon cannot read projection outbox');
select ok(not has_table_privilege('service_role', 'public.ops_projection_outbox', 'INSERT'), 'service_role cannot directly insert projections');
select ok(not has_table_privilege('service_role', 'public.ops_projection_outbox', 'UPDATE'), 'service_role cannot directly update projections');
select ok(not has_table_privilege('service_role', 'public.ops_projection_outbox', 'DELETE'), 'service_role cannot directly delete projections');
select ok(not has_table_privilege('anon', 'public.ops_provider_snapshots', 'SELECT'), 'anon cannot read provider snapshots');
select ok(not has_table_privilege('service_role', 'public.ops_provider_snapshots', 'INSERT'), 'snapshot writes require the normalized RPC');
select ok(not has_function_privilege('authenticated', 'public.enqueue_ops_projection(uuid,text,text,text,text,text,bigint,jsonb)', 'EXECUTE'), 'authenticated cannot enqueue projections');
select ok(to_regclass('public.email_suppressions_lower_reason_key') is not null, 'suppression uniqueness is canonicalized');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'ops_profile_projection'), 'profile changes emit projections');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.workspace_members'::regclass and tgname = 'ops_member_projection'), 'membership changes emit projections');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'ops_lead_projection'), 'lead changes emit projections');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.billing_offer_acceptances'::regclass and tgname = 'ops_billing_projection'), 'billing changes emit projections');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.customer_communication_preferences'::regclass and tgname = 'ops_preference_projection'), 'preference changes emit projections');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.report_email_leads'::regclass and tgname = 'ops_report_email_lead_association'), 'report leads have explicit enquiry association');

select lives_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'contact', 'profile-1', 'upsert', 'event-1', 1,
  '{"email":"owner@example.com"}'::jsonb
) $$, 'valid contact projection is accepted');
select is((select count(*)::int from public.ops_projection_outbox), 1, 'one projection is queued');
select throws_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'enquiry', 'invalid-mautic-enquiry', 'upsert', 'invalid-event-1', 1,
  '{}'::jsonb
) $$, '23514', 'new row for relation "ops_projection_outbox" violates check constraint "ops_projection_provider_aggregate_check"', 'Mautic cannot receive enquiry aggregates');
select throws_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'chatwoot', 'contact', 'invalid-chatwoot-contact', 'upsert', 'invalid-event-2', 1,
  '{}'::jsonb
) $$, '23514', 'new row for relation "ops_projection_outbox" violates check constraint "ops_projection_provider_aggregate_check"', 'Chatwoot cannot receive contact aggregates');
select lives_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'contact', 'profile-1', 'upsert', 'event-1', 1,
  '{"email":"owner@example.com"}'::jsonb
) $$, 'duplicate source event is idempotent');
select is((select count(*)::int from public.ops_projection_outbox), 1, 'duplicate does not add a row');
select lives_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'contact', 'profile-1', 'upsert', 'late-event', 1,
  '{}'::jsonb
) $$, 'out-of-order source event is safely ignored');
select is((select count(*)::int from public.ops_projection_outbox), 1, 'out-of-order event does not add work');

select ok((select count(*)::int from public.claim_ops_projection('mautic', 60)) = 1, 'v1 projection can be leased');
select is((select status from public.ops_projection_outbox where source_version = 1), 'processing', 'v1 is processing before newer source event');
select lives_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'contact', 'profile-1', 'upsert', 'event-v2', 2,
  '{"email":"new-owner@example.com"}'::jsonb
) $$, 'newer source version is accepted');
select is((select status from public.ops_projection_outbox where source_version = 1), 'completed', 'older processing version is superseded');
select is((select last_error from public.ops_projection_outbox where source_version = 1), 'superseded_by_newer_source_version', 'superseded receipt is explicit');
select ok(not public.complete_ops_projection('81111111-1111-4111-8111-111111111111', (select id from public.ops_projection_outbox where source_version = 1), gen_random_uuid()), 'stale v1 settlement is rejected');
select ok((select count(*)::int from public.claim_ops_projection('mautic', 60)) = 1, 'v2 projection can be leased after fencing v1');
select ok(public.complete_ops_projection('81111111-1111-4111-8111-111111111111', (select id from public.ops_projection_outbox where source_version = 2), (select lease_token from public.ops_projection_outbox where source_version = 2)), 'v2 lease can complete');
select is((select status from public.ops_projection_outbox where source_version = 2), 'completed', 'v2 completion is durable');
select throws_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'chatwoot', 'enquiry', 'lead-1', 'upsert', 'event-2', 1,
  '{"workspaceId":"92222222-2222-4222-8222-222222222222"}'::jsonb
) $$, '22023', 'operations projection workspace mismatch', 'payload workspace mismatch is rejected');

insert into public.customer_communication_preferences (workspace_id, email, marketing_consent, topics)
values ('81111111-1111-4111-8111-111111111111', 'owner@example.com', 'granted', array['product_updates']);
select is((select allowed from public.can_send_marketing('81111111-1111-4111-8111-111111111111', 'owner@example.com', 'product_updates')), true, 'consented topic is allowed');
select is((select reason from public.can_send_marketing('81111111-1111-4111-8111-111111111111', 'owner@example.com', 'newsletter')), 'topic_not_consented', 'unconsented topic is denied');
update public.customer_communication_preferences set unsubscribed_at = now() where workspace_id = '81111111-1111-4111-8111-111111111111';
select is((select reason from public.can_send_marketing('81111111-1111-4111-8111-111111111111', 'owner@example.com', 'product_updates')), 'unsubscribed', 'unsubscribe is a hard deny');

-- Legacy case-variant duplicate: the newer withdrawn state wins, but the
-- restrictive state survives and the discarded row is retained in archive.
drop index public.customer_communication_preferences_workspace_lower_email_key;
insert into public.customer_communication_preferences (id, workspace_id, email, marketing_consent, topics, updated_at, created_at)
values ('85555555-5555-4555-8555-555555555551', '81111111-1111-4111-8111-111111111111', 'Consent-Case@example.test', 'granted', array['product_updates'], now() - interval '2 days', now() - interval '2 days');
insert into public.customer_communication_preferences (id, workspace_id, email, marketing_consent, topics, updated_at, created_at)
values ('85555555-5555-4555-8555-555555555552', '81111111-1111-4111-8111-111111111111', 'consent-case@example.test', 'withdrawn', array['product_updates'], now(), now());
with ranked as (
  select id, workspace_id, email, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences
), grouped as (
  select workspace_id, lower(btrim(email)) as email_key, bool_or(coalesce(suppressed, false)) as any_suppressed, max(unsubscribed_at) as latest_unsubscribed_at, bool_or(marketing_consent = 'withdrawn') as any_withdrawn, bool_or(marketing_consent = 'denied') as any_denied
  from public.customer_communication_preferences group by workspace_id, lower(btrim(email))
), winners as (
  select r.id, g.any_suppressed, g.latest_unsubscribed_at, g.any_withdrawn, g.any_denied
  from ranked r join grouped g on g.workspace_id = r.workspace_id and g.email_key = lower(btrim(r.email)) where r.rn = 1
)
update public.customer_communication_preferences p set suppressed = p.suppressed or w.any_suppressed, unsubscribed_at = coalesce(p.unsubscribed_at, w.latest_unsubscribed_at), marketing_consent = case when w.any_withdrawn then 'withdrawn' when w.any_denied then 'denied' else p.marketing_consent end from winners w where p.id = w.id;
with ranked as (
  select id, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences
)
insert into legacy_archive.customer_operations_consent_reconciliation_202609040003 (source_table, row_id, reason, row_data)
select 'customer_communication_preferences', p.id::text, 'test_duplicate_canonical_workspace_email', to_jsonb(p) from public.customer_communication_preferences p join ranked r on r.id = p.id where r.rn > 1;
with ranked as (
  select id, row_number() over (partition by workspace_id, lower(btrim(email)) order by updated_at desc, created_at desc, id desc) as rn
  from public.customer_communication_preferences
)
delete from public.customer_communication_preferences p using ranked r where p.id = r.id and r.rn > 1;
create unique index customer_communication_preferences_workspace_lower_email_key on public.customer_communication_preferences (workspace_id, lower(email));
select is((select marketing_consent from public.customer_communication_preferences where id = '85555555-5555-4555-8555-555555555552'), 'withdrawn', 'newest consent state is retained');
select is((select reason from public.can_send_marketing('81111111-1111-4111-8111-111111111111', 'CONSENT-CASE@EXAMPLE.TEST', 'product_updates')), 'consent_not_granted', 'withdrawn duplicate cannot resurrect marketing permission');
select is((select count(*)::int from legacy_archive.customer_operations_consent_reconciliation_202609040003 where row_id = '85555555-5555-4555-8555-555555555551'), 1, 'discarded consent duplicate is archived');

select lives_ok($$ select public.upsert_ops_provider_snapshot(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'delivery', 'contact', 'profile-1', 'delivered', null, null, 'email', 'delivered', '****1234', null, now(), 'delivery-1', 1, '{"deliveryStatus":"delivered"}'::jsonb
) $$, 'safe provider snapshot is accepted');
select is((select provider_record_suffix from public.ops_provider_snapshots where aggregate_id = 'profile-1'), '****1234', 'provider identifier is masked');
select throws_ok($$ select public.upsert_ops_provider_snapshot(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'delivery', 'contact', 'profile-unsafe', 'delivered', null, null, 'email', 'delivered', 'provider-raw-id', null, now(), 'delivery-unsafe', 1, '{"metadata":{"secret":"no"}}'::jsonb
) $$, '22023', 'invalid provider snapshot identity', 'raw provider suffix is rejected');
select lives_ok($$ select public.upsert_ops_provider_snapshot(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'delivery', 'contact', 'profile-1', 'delivered', null, null, 'email', 'delivered', '****1234', null, now(), 'delivery-2', 2, '{"deliveryStatus":"delivered","email":"not persisted"}'::jsonb
) $$, 'newer provider snapshot version is accepted');
select is((select safe_data ? 'email' from public.ops_provider_snapshots where aggregate_id = 'profile-1'), false, 'snapshot safe data is allowlisted');

select ok((select count(*)::int from public.ops_enquiry_associations) = 0, 'no implicit email enquiry association is created');
insert into public.demo_requests (name, email, source) values ('Demo Visitor', 'demo@example.com', 'landing');
select ok((select workspace_id from public.ops_enquiry_associations where source_id = (select id::text from public.demo_requests where email = 'demo@example.com' limit 1)) is null, 'demo enquiry remains unscoped until explicit association');
select lives_ok($$ select public.associate_ops_enquiry((select id from public.ops_enquiry_associations where source_id = (select id::text from public.demo_requests where email = 'demo@example.com' limit 1)), '81111111-1111-4111-8111-111111111111', null, 'crm_match') $$, 'enquiry association uses service RPC');
select is((select workspace_id from public.ops_enquiry_associations where source_id = (select id::text from public.demo_requests where email = 'demo@example.com' limit 1)), '81111111-1111-4111-8111-111111111111'::uuid, 'RPC association is workspace scoped');
insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, subject)
values ('81111111-1111-4111-8111-111111111111', 'crm', 'crm-1', 'sales', 'Explicit CRM association');
select ok(exists (select 1 from public.ops_projection_outbox where provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = (select id::text from public.ops_enquiry_associations where source_id = 'crm-1')), 'explicit enquiry association emits provider-neutral projection');
select is((select payload - 'workspaceId' - 'subject' - 'status' from public.ops_projection_outbox where provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = (select id::text from public.ops_enquiry_associations where source_id = 'crm-1') order by created_at desc limit 1), '{}'::jsonb, 'enquiry payload contains only safe workspace subject and status');
select is((select source_event_id from public.ops_projection_outbox where provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = (select id::text from public.ops_enquiry_associations where source_id = 'crm-1') order by created_at desc limit 1), 'enquiry-association:' || (select id::text from public.ops_enquiry_associations where source_id = 'crm-1') || ':' || (select source_version::text from public.ops_projection_outbox where provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = (select id::text from public.ops_enquiry_associations where source_id = 'crm-1') order by created_at desc limit 1), 'enquiry source event uses internal association UUID and sequence version');

insert into public.report_email_leads (email, postcode, suburb, source)
values ('report-visitor@example.test', '6000', 'Perth', 'ops-test');
select is((select enquiry_type from public.ops_enquiry_associations where source_id = (select id::text from public.report_email_leads where email = 'report-visitor@example.test' limit 1)), 'report_email_lead', 'report lead association preserves its source type');
select ok((select workspace_id from public.ops_enquiry_associations where source_id = (select id::text from public.report_email_leads where email = 'report-visitor@example.test' limit 1)) is null, 'report lead remains unscoped until explicit association');

-- Fresh bootstrap fixture: contact identity is the real owner profile, not a
-- synthetic workspace contact. Activation may add lifecycle fields but must
-- converge to the same profile aggregate and leave one usable pending row.
insert into public.workspaces (id, name, mode, region)
values ('83333333-3333-4333-8333-333333333333', 'Bootstrap identity test', 'self_serve', 'AU');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '84444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'bootstrap-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now());
insert into public.profiles (id, email, full_name)
values ('84444444-4444-4444-8444-444444444444', 'Bootstrap-Owner@Example.Test', 'Bootstrap Owner');
insert into public.workspace_members (workspace_id, profile_id, role)
values ('83333333-3333-4333-8333-333333333333', '84444444-4444-4444-8444-444444444444', 'owner');
insert into public.customer_activations (workspace_id, email_verified_at)
values ('83333333-3333-4333-8333-333333333333', now());
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'contact' and aggregate_id = '84444444-4444-4444-8444-444444444444' and status = 'pending'), 1, 'bootstrap has one usable owner contact mapping');
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'contact' and aggregate_id = '83333333-3333-4333-8333-333333333333'), 0, 'bootstrap never creates a workspace contact aggregate');
select is((select payload ->> 'email' from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and aggregate_type = 'contact' and status = 'pending' limit 1), 'bootstrap-owner@example.test', 'owner contact payload uses canonical lowercase email');
select is((select payload ->> 'activationStage' from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and aggregate_type = 'contact' and status = 'pending' limit 1), 'trial', 'owner contact carries activation stage');
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'lifecycle' and aggregate_id = '84444444-4444-4444-8444-444444444444' and status = 'pending'), 1, 'activation lifecycle targets the real owner profile');
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'lifecycle' and aggregate_id = '83333333-3333-4333-8333-333333333333'), 0, 'activation never creates a synthetic workspace lifecycle contact');
select lives_ok($$ select public.enqueue_ops_projection('83333333-3333-4333-8333-333333333333', 'mautic', 'lifecycle', '83333333-3333-4333-8333-333333333333', 'upsert', 'legacy-test-source', nextval('public.ops_projection_source_version_seq'), '{}'::jsonb) $$, 'legacy workspace lifecycle fixture is queued');
select is(public.repair_ops_legacy_lifecycle_projections(), 1, 'legacy workspace lifecycle work is replaced once');
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'lifecycle' and aggregate_id = '84444444-4444-4444-8444-444444444444' and source_event_id like 'legacy-lifecycle-repair:%'), 1, 'legacy repair queues a profile lifecycle replacement');
select is((select payload ->> 'profileId' from public.ops_projection_outbox where provider = 'mautic' and aggregate_type = 'lifecycle' and source_event_id like 'legacy-lifecycle-repair:%' limit 1), '84444444-4444-4444-8444-444444444444', 'legacy lifecycle replacement carries the exact profile identity');
select is((select last_error from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and aggregate_type = 'lifecycle' and aggregate_id = '83333333-3333-4333-8333-333333333333' and source_event_id = 'legacy-test-source'), 'repaired_legacy_workspace_lifecycle_identity', 'legacy synthetic row is marked only after replacement queueing');
select lives_ok($$ select public.enqueue_ops_projection('83333333-3333-4333-8333-333333333333', 'mautic', 'lifecycle', '83333333-3333-4333-8333-333333333333', 'upsert', 'legacy-ordered-test', nextval('public.ops_projection_source_version_seq'), '{}'::jsonb) $$, 'ordered legacy workspace lifecycle fixture is queued');
update public.ops_projection_outbox set status = 'completed', last_error = 'superseded_legacy_workspace_lifecycle_identity' where workspace_id = '83333333-3333-4333-8333-333333333333' and aggregate_type = 'lifecycle' and aggregate_id = '83333333-3333-4333-8333-333333333333' and source_event_id = 'legacy-ordered-test';
select is(public.repair_ops_superseded_lifecycle_projections(), 1, 'ordered repair replaces rows carrying the 015 superseded marker');
select is((select count(*)::int from public.ops_projection_outbox where workspace_id = '83333333-3333-4333-8333-333333333333' and provider = 'mautic' and aggregate_type = 'lifecycle' and aggregate_id = '84444444-4444-4444-8444-444444444444' and source_event_id like 'legacy-lifecycle-repair:%'), 2, 'ordered repair adds one profile lifecycle beside the prior legacy replacement');
select is(public.repair_ops_superseded_lifecycle_projections(), 0, 'ordered repair is idempotent after the repaired marker is written');

select * from finish();
rollback;
