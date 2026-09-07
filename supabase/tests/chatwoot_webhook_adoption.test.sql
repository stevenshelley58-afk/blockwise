create extension if not exists pgtap with schema extensions;
begin;
select plan(15);

insert into public.workspaces(id,name,mode,region) values
 ('c8111111-1111-4111-8111-111111111111','Chatwoot adoption test','self_serve','AU') on conflict(id) do nothing;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000','c8222222-2222-4222-8222-222222222222','authenticated','authenticated','chatwoot-test@example.test','', '{}','{}',now(),now(),now()) on conflict(id) do nothing;
insert into public.profiles(id,email,full_name,is_operator,operator_role) values('c8222222-2222-4222-8222-222222222222','chatwoot-test@example.test','Chatwoot Test',true,'owner') on conflict(id) do update set is_operator=true,operator_role='owner';
insert into public.workspace_members(workspace_id,profile_id,role) values('c8111111-1111-4111-8111-111111111111','c8222222-2222-4222-8222-222222222222','owner') on conflict do nothing;

insert into private.ops_provider_operation_ledger(operation_key,workspace_id,provider,aggregate_type,aggregate_id,source_version,intent,provider_contact_id_digest)
 values('chatwoot:test-contact','c8111111-1111-4111-8111-111111111111','chatwoot','contact','c8222222-2222-4222-8222-222222222222',1,'{"accountId":"7","inboxId":"8"}',repeat('a',64)) on conflict(operation_key) do nothing;
select lives_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-known',repeat('b',64),'7','8','conversation_created','101','',repeat('a',64),'v1:iv:tag:cipher','open','',now()::text,'Known sender','[]'::jsonb) $$,'known provider contact is adopted');
select is((select count(*)::int from public.ops_enquiry_associations where source_system='chatwoot' and source_id like 'conversation:%'),1,'known adoption creates one enquiry');
select ok((select provider_conversation_id_ciphertext is not null from private.ops_provider_operation_ledger where operation_key like 'chatwoot:conversation:%'),'adoption persists encrypted conversation identity');
select lives_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-known-message',repeat('c',64),'7','8','message_created','101','202',repeat('a',64),'v1:iv:tag:cipher','open','Hello',now()::text,'Sender','[{"name":"a.txt"}]'::jsonb) $$,'known incoming message is stored');
select is((select count(*)::int from private.ops_enquiry_messages where enquiry_id=(select id from public.ops_enquiry_associations where source_system='chatwoot' and source_id like 'conversation:%' limit 1)),1,'message is attached to adopted enquiry');
select lives_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-global',repeat('d',64),'7','8','conversation_created','102','',repeat('e',64),'v1:iv:tag:cipher','open','',now()::text,null,'[]'::jsonb) $$,'unknown contact becomes unassigned enquiry');
select is((select count(*)::int from public.ops_enquiry_associations where source_system='chatwoot' and source_id like 'conversation:%' and workspace_id is null),1,'unknown contact is unassigned');
select throws_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-known-message',repeat('f',64),'7','8','message_created','101','202',repeat('a',64),'v1:iv:tag:cipher','open','tampered',now()::text,'Sender','[]'::jsonb) $$,'22023','Chatwoot webhook event hash mismatch','same delivery with a different hash is rejected');
select lives_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-known-message',repeat('c',64),'7','8','message_created','101','202',repeat('a',64),'v1:iv:tag:cipher','open','Hello',now()::text,'Sender','[]'::jsonb) $$,'duplicate delivery is replay-safe');
select is((select count(*)::int from private.ops_enquiry_messages where provider_message_id=encode(extensions.digest('202','sha256'),'hex')),1,'duplicate message does not duplicate storage');
select is(jsonb_array_length((select x->'messages' from jsonb_array_elements(public.resolve_ops_enquiry_threads()) x where (x->>'enquiry_id')=(select id::text from public.ops_enquiry_associations where source_id like 'conversation:%' and workspace_id is not null limit 1))),1,'thread resolver returns bounded message timeline');
select is((select count(*)::int from public.ops_enquiry_associations where source_system='chatwoot' and source_id='conversation:'||encode(extensions.digest('101','sha256'),'hex')),1,'concurrent-safe source binding is unique');
select ok(not exists(select 1 from public.ops_enquiry_associations where source_system='chatwoot' and source_id='101'),'public association never stores raw conversation id');
select lives_ok($$ select public.record_ops_chatwoot_webhook_adopt('delivery-cross',repeat('9',64),'7','8','message_created','101','203',repeat('e',64),'v1:iv:tag:cipher','open','cross-tenant attempt',now()::text,'Other Sender','[]'::jsonb) $$,'cross-tenant claim is ignored instead of rebound');
select is((select count(*)::int from private.ops_enquiry_messages where body='cross-tenant attempt'),0,'cross-tenant message is never stored');
select * from finish();
