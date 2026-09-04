select plan(25);

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

select has_column('public', 'workspaces', 'ops_version', 'customer workspace has an authoritative action version');
select has_column('public', 'workspace_members', 'ops_version', 'member targets have an authoritative action version');
select has_column('public', 'workspace_invitations', 'ops_version', 'invitation targets have an authoritative action version');
select has_column('public', 'billing_offer_acceptances', 'ops_version', 'billing targets have an authoritative action version');
select has_column('public', 'audit_logs', 'ops_version', 'session activity targets have an authoritative action version');
select has_column('public', 'ops_enquiry_associations', 'ops_version', 'enquiry targets have an authoritative action version');
select ok(exists(select 1 from pg_trigger where tgrelid='public.workspaces'::regclass and tgname='ops_workspace_target_version'), 'workspace updates advance action versions');
select ok(exists(select 1 from pg_trigger where tgrelid='public.workspace_invitations'::regclass and tgname='ops_invitation_target_version'), 'invitation updates advance action versions');
select ok(exists(select 1 from pg_trigger where tgrelid='public.billing_offer_acceptances'::regclass and tgname='ops_billing_target_version'), 'billing updates advance action versions');
select has_table('private', 'ops_invitation_delivery_ledger', 'invitation side effects have a durable reservation ledger');
select has_function('public', 'begin_ops_invitation_delivery', array['uuid','text','uuid','uuid'], 'invitation reservation RPC exists');
select has_function('public', 'start_ops_invitation_delivery', array['uuid'], 'invitation start RPC exists');
select has_function('public', 'reconcile_ops_invitation_delivery', array['uuid'], 'invitation reconciliation RPC exists');
select has_function('public', 'quarantine_ops_invitation_delivery', array['uuid','text'], 'ambiguous invitation quarantine RPC exists');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='ops_invitation_delivery_ledger' and grantee='service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')), 'invitation ledger has no direct service-role access');

select * from finish();
