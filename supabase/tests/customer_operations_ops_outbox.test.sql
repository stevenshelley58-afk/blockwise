create extension if not exists pgtap with schema extensions;

begin;
select plan(19);

insert into public.workspaces (id, name, mode, region)
values ('81111111-1111-4111-8111-111111111111', 'Ops contract test', 'self_serve', 'AU')
on conflict (id) do nothing;

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

select ok((select count(*)::int from public.claim_ops_projection('mautic', 60)) = 1, 'pending projection can be leased');
select ok((select status from public.ops_projection_outbox) = 'processing', 'claim records processing status');
select ok(public.complete_ops_projection('81111111-1111-4111-8111-111111111111', (select id from public.ops_projection_outbox), (select lease_token from public.ops_projection_outbox)), 'valid lease can complete projection');
select is((select status from public.ops_projection_outbox), 'completed', 'projection completion is durable');

select * from finish();
rollback;
