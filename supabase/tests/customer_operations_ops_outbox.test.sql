create extension if not exists pgtap with schema extensions;

begin;
select plan(28);

insert into public.workspaces (id, name, mode, region)
values ('81111111-1111-4111-8111-111111111111', 'Ops contract test', 'self_serve', 'AU')
on conflict (id) do nothing;

-- The bootstrap trigger is expected to enqueue a contact projection. Keep the
-- fixture deterministic for the explicit version-fencing assertions below.
delete from public.ops_projection_outbox
where workspace_id = '81111111-1111-4111-8111-111111111111';

select ok(to_regclass('public.customer_communication_preferences') is not null, 'communication preferences table exists');
select ok(to_regclass('public.ops_projection_outbox') is not null, 'projection outbox exists');
select ok((select relrowsecurity from pg_class where oid = 'public.ops_projection_outbox'::regclass), 'projection outbox RLS is enabled');
select ok(not has_table_privilege('anon', 'public.ops_projection_outbox', 'SELECT'), 'anon cannot read projection outbox');
select ok(not has_function_privilege('authenticated', 'public.enqueue_ops_projection(uuid,text,text,text,text,text,bigint,jsonb)', 'EXECUTE'), 'authenticated cannot enqueue projections');

select lives_ok($$ select public.enqueue_ops_projection(
  '81111111-1111-4111-8111-111111111111', 'mautic', 'contact', 'profile-1', 'upsert', 'event-1', 1,
  '{"email":"owner@example.com"}'::jsonb
) $$, 'valid contact projection is accepted');
select is((select count(*)::int from public.ops_projection_outbox), 1, 'one projection is queued');
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

select ok((select count(*)::int from public.ops_enquiry_associations) = 0, 'no implicit email enquiry association is created');
insert into public.demo_requests (name, email, source) values ('Demo Visitor', 'demo@example.com', 'landing');
select ok((select workspace_id from public.ops_enquiry_associations where source_id = (select id::text from public.demo_requests where email = 'demo@example.com' limit 1)) is null, 'demo enquiry remains unscoped until explicit association');
insert into public.ops_enquiry_associations (workspace_id, source_system, source_id, enquiry_type, subject)
values ('81111111-1111-4111-8111-111111111111', 'crm', 'crm-1', 'sales', 'Explicit CRM association');
select ok(exists (select 1 from public.ops_projection_outbox where provider = 'chatwoot' and aggregate_type = 'enquiry' and aggregate_id = (select id::text from public.ops_enquiry_associations where source_id = 'crm-1')), 'explicit enquiry association emits provider-neutral projection');

select * from finish();
rollback;
