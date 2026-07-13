create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

-- Keep the fixture committed so independent dblink sessions can observe it.
begin;
set constraints all deferred;
delete from public.adstudio_creative_revision_mutations
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_creative_revisions
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_creatives
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_campaign_variants
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_campaigns
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_brand_kits
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.workspaces where id = 'd1000000-0000-4000-8000-000000000001';
commit;

insert into public.workspaces (id, name)
values ('d1000000-0000-4000-8000-000000000001', 'Revision Concurrency Test');
insert into public.adstudio_brand_kits (id, workspace_id, business_name)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Concurrency Realty'
);
insert into public.adstudio_campaigns (
  id, workspace_id, brand_kit_id, name, goal, offer_id
) values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Concurrency Campaign',
  'seller_leads',
  'just-listed-double'
);
insert into public.adstudio_campaign_variants (
  id, workspace_id, campaign_id, angle, headline, offer, cta
) values (
  'd4000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'listing',
  'Just listed',
  'Inspection',
  'Learn more'
);
insert into public.adstudio_creatives (
  id, workspace_id, campaign_id, variant_id, format, width, height,
  canvas_json, render_status
) values (
  'd5000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  '4:5', 1080, 1350,
  '{"version":"initial","objects":[]}'::jsonb,
  'rendered'
);

begin;
select plan(3);

select extensions.dblink_connect(
  'revision_claimant',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database()
    || ' user=' || current_user || ' password=' || current_user
);
select extensions.dblink_connect(
  'revision_writer',
  'host=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database()
    || ' user=' || current_user || ' password=' || current_user
);

-- The advisory lock is a deterministic rendezvous: the claimant reaches it
-- only after its RPC has locked the creative and installed the pending claim.
select pg_advisory_lock(73130003);
select extensions.dblink_send_query(
  'revision_claimant',
  $$
    with jwt as materialized (
      select set_config('request.jwt.claims', '{"role":"service_role"}', true)
    ), claims as materialized (
      select claim.state
      from jwt
      cross join lateral public.adstudio_claim_creative_revision_mutation(
        'd1000000-0000-4000-8000-000000000001',
        'd5000000-0000-4000-8000-000000000001',
        (
          select active_revision_id from public.adstudio_creatives
          where workspace_id = 'd1000000-0000-4000-8000-000000000001'
            and id = 'd5000000-0000-4000-8000-000000000001'
        ),
        'd6000000-0000-4000-8000-000000000001',
        repeat('d', 64)
      ) as claim
    ), held as materialized (
      select pg_advisory_xact_lock(73130003) from claims
    )
    select state from claims cross join held
  $$
);

do $wait_for_claim$
declare
  attempt integer;
begin
  for attempt in 1..200 loop
    exit when exists (
      select 1 from pg_locks
      where locktype = 'advisory' and not granted
    );
    perform pg_sleep(0.01);
  end loop;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and not granted) then
    raise exception 'Concurrent claim did not reach the row-lock rendezvous.';
  end if;
end
$wait_for_claim$;

select extensions.dblink_send_query(
  'revision_writer',
  $$
    update public.adstudio_creatives
    set canvas_json = '{"version":"campaign-race","objects":[]}'::jsonb
    where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      and id = 'd5000000-0000-4000-8000-000000000001'
  $$
);
select pg_sleep(0.1);
select is(
  extensions.dblink_is_busy('revision_writer'),
  1,
  'a campaign/direct writer waits behind the in-flight claim row lock'
);

select pg_advisory_unlock(73130003);
select is(
  (
    select state
    from extensions.dblink_get_result('revision_claimant') as result(state text)
  ),
  'claimed',
  'the concurrent claim commits before the waiting version write resumes'
);
select throws_ok(
  $$
    select *
    from extensions.dblink_get_result('revision_writer') as result(updated integer)
  $$,
  '55P03',
  'ADSTUDIO_EDIT_IN_PROGRESS',
  'the waiting version write is rejected after observing the committed claim'
);

select * from finish();
rollback;

select extensions.dblink_disconnect('revision_claimant');
select extensions.dblink_disconnect('revision_writer');

-- The claim committed in the independent session; remove the fixture explicitly.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.adstudio_release_creative_revision_mutation(
  'd1000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001'
);
begin;
set constraints all deferred;
delete from public.adstudio_creative_revision_mutations
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_creative_revisions
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_creatives
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_campaign_variants
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_campaigns
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.adstudio_brand_kits
where workspace_id = 'd1000000-0000-4000-8000-000000000001';
delete from public.workspaces where id = 'd1000000-0000-4000-8000-000000000001';
commit;
