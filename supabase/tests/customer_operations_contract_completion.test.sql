select plan(29);

insert into public.workspaces (id, name, mode, region)
values ('81111111-1111-4111-8111-111111111111', 'Provider step contract test', 'self_serve', 'AU')
on conflict (id) do nothing;

select has_column('public', 'email_outbox', 'workspace_id', 'email ownership is an explicit tenant field');
select has_column('private', 'ops_provider_operation_ledger', 'completed_steps', 'provider steps are durable');
select has_column('private', 'ops_provider_operation_ledger', 'step_digests', 'provider step digests are durable');
select has_function('public', 'record_ops_provider_step', array['text','text','text','text','text'], 'step ledger RPC exists');
select lives_ok($$ select public.begin_ops_provider_operation('ops:test:provider-step-validation','81111111-1111-4111-8111-111111111111','mautic','contact','84444444-4444-4444-8444-444444444444',1,'{}'::jsonb) $$, 'provider step validation fixture is prepared');
select throws_ok($$ select public.record_ops_provider_step('ops:test:provider-step-validation','contact.upsert','contact','plaintext-provider-id',repeat('a',64)) $$, '22023', 'invalid provider operation step', 'provider step rejects plaintext identifiers at the database boundary');
select is(public.record_ops_provider_step('ops:test:provider-step-validation','contact.upsert','contact','v1:iv:tag:ciphertext',repeat('a',64)), true, 'provider step accepts the protected v1 ciphertext format');
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
select ok(exists(select 1 from pg_index where indexrelid='private.ops_invitation_delivery_unresolved_invitation'::regclass and indisunique), 'an invitation has at most one unresolved delivery');
select has_function('public', 'begin_ops_invitation_delivery', array['uuid','text','uuid','uuid'], 'invitation reservation RPC exists');
select has_function('public', 'start_ops_invitation_delivery', array['uuid'], 'invitation start RPC exists');
select has_function('public', 'reconcile_ops_invitation_delivery', array['uuid'], 'invitation reconciliation RPC exists');
select has_function('public', 'quarantine_ops_invitation_delivery', array['uuid','text'], 'ambiguous invitation quarantine RPC exists');
select ok(not exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='ops_invitation_delivery_ledger' and grantee='service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')), 'invitation ledger has no direct service-role access');

select * from finish();
