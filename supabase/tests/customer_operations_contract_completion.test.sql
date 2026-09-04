select plan(10);

select has_column('public', 'email_outbox', 'workspace_id', 'email ownership is an explicit tenant field');
select has_column('private', 'ops_provider_operation_ledger', 'completed_steps', 'provider steps are durable');
select has_column('private', 'ops_provider_operation_ledger', 'step_digests', 'provider step digests are durable');
select has_function('public', 'record_ops_provider_step', array['text','text','text','text','text'], 'step ledger RPC exists');
select ok(exists(select 1 from pg_trigger where tgrelid='public.leads'::regclass and tgname='ops_lead_association'), 'lead association trigger exists');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='ops_provider_operation_ledger' and grantee='service_role' and privilege_type in ('INSERT','UPDATE','DELETE')), 'ledger has no direct service-role writes');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='ops_provider_operation_ledger' and grantee='service_role' and privilege_type='SELECT'), 'ledger has no direct service-role reads');
select ok(not exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname='ops_provider_correlations'), 'obsolete correlation table is removed');
select ok(not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('resolve_ops_provider_correlation','record_ops_provider_correlation')), 'obsolete correlation RPCs are removed');
select ok(exists(select 1 from pg_trigger where tgrelid='public.ops_enquiry_associations'::regclass and tgname='ops_enquiry_projection'), 'association rows enqueue projections');

select * from finish();
