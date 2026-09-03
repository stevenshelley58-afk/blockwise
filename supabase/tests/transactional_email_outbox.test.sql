create extension if not exists pgtap with schema extensions;

begin;
select plan(10);
select has_table('public', 'email_outbox', 'transactional email outbox exists');
select has_column('public', 'email_outbox', 'lease_token', 'outbox has a fencing token');
select has_column('public', 'email_outbox', 'provider_message_id', 'outbox stores provider message id');
select has_function('public', 'claim_email_outbox_batch', array['integer'], 'claim RPC exists');
select has_table('public', 'email_suppressions', 'email suppression table exists');
select has_table('public', 'email_lifecycle_events', 'lifecycle events table exists');
select has_column('public', 'demo_requests', 'lead_welcome_enqueue_status', 'demo welcome recovery state exists');
select has_column('public', 'demo_requests', 'lead_welcome_enqueue_error', 'demo welcome recovery error exists');
select ok((select relrowsecurity from pg_class where oid = 'public.email_outbox'::regclass), 'outbox RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.email_suppressions'::regclass), 'suppression RLS is enabled');
select * from finish();
rollback;
