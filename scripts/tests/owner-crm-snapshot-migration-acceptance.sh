#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
migration="$root/supabase/migrations/20260912060000_owner_crm_customer_snapshot.sql"
container="blockwise-owner-crm-snapshot-native-$$"
volume="blockwise-owner-crm-snapshot-native-$$-data"
image="${POSTGRES_TEST_IMAGE:-postgres:17.6-alpine}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if docker container inspect "$container" >/dev/null 2>&1 \
  || docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "Refusing to reuse an existing owner CRM migration-test resource." >&2
  exit 2
fi
[[ -f "$migration" ]] || { echo "Missing migration: $migration" >&2; exit 2; }

docker volume create "$volume" >/dev/null
docker run -d \
  --name "$container" \
  --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$volume:/var/lib/postgresql/data" \
  "$image" >/dev/null

ready=false
for _ in $(seq 1 60); do
  if docker logs "$container" 2>&1 \
      | grep -F "PostgreSQL init process complete; ready for start up." >/dev/null \
    && docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select 1" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$container" >&2
  exit 1
fi

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role owner_crm_untrusted nologin;

create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text
);

create table public.workspaces (
  id uuid primary key,
  created_by uuid references public.profiles(id),
  billing_access_state text,
  stripe_subscription_status text,
  trial_state text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references public.profiles(id),
  role text not null,
  primary key (workspace_id, profile_id)
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;

create policy profiles_fail_closed on public.profiles
  for all using (false) with check (false);
create policy workspaces_fail_closed on public.workspaces
  for all using (false) with check (false);
create policy workspace_members_fail_closed on public.workspace_members
  for all using (false) with check (false);

revoke all on public.profiles, public.workspaces, public.workspace_members
  from public, anon, authenticated, owner_crm_untrusted;
grant usage on schema public to service_role;
grant select on public.profiles, public.workspaces, public.workspace_members
  to service_role;

insert into public.profiles (id, email, full_name) values
  ('10000000-0000-4000-8000-000000000001', 'sole-owner@example.test', 'Sole Owner'),
  ('10000000-0000-4000-8000-000000000002', 'creator-without-membership@example.test', 'Missing Membership Creator'),
  ('10000000-0000-4000-8000-000000000003', 'multiple-owner-a@example.test', 'Multiple Owner A'),
  ('10000000-0000-4000-8000-000000000004', 'multiple-owner-b@example.test', 'Multiple Owner B'),
  ('10000000-0000-4000-8000-000000000005', 'multi-workspace-owner@example.test', 'Multi Workspace Owner'),
  ('10000000-0000-4000-8000-000000000006', 'second-workspace-owner@example.test', 'Second Workspace Owner'),
  ('10000000-0000-4000-8000-000000000007', 'mismatched-creator@example.test', 'Mismatched Creator'),
  ('10000000-0000-4000-8000-000000000008', 'mismatched-owner@example.test', 'Mismatched Owner');

insert into public.workspaces (
  id,
  created_by,
  billing_access_state,
  stripe_subscription_status,
  trial_state,
  trial_started_at,
  trial_ends_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'unbilled', 'past_due', 'pending_delivery', null, null
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'trialing', null, 'active',
    '2026-09-01T00:00:00Z', '2026-09-15T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'paid', 'active', 'active',
    '2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    'paid', 'active', 'active',
    '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000006',
    'paid', 'active', 'active',
    '2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000007',
    'payment_recovery', 'past_due', 'active',
    '2026-05-01T00:00:00Z', '2026-05-15T00:00:00Z'
  );

insert into public.workspace_members (workspace_id, profile_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'owner'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'owner'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', 'owner'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'member'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006', 'owner'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000008', 'owner');

create schema migration_test;
create table migration_test.fixture_baseline as
select
  (select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]')) from public.profiles p)
    as profiles_digest,
  (select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id)::text, '[]')) from public.workspaces w)
    as workspaces_digest,
  (
    select md5(coalesce(jsonb_agg(to_jsonb(wm) order by wm.workspace_id, wm.profile_id)::text, '[]'))
    from public.workspace_members wm
  ) as members_digest,
  (
    select jsonb_agg(
      jsonb_build_object(
        'table', c.relname,
        'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'acl', coalesce(c.relacl::text, '')
      ) order by c.relname
    )
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array['profiles', 'workspace_members', 'workspaces'])
  ) as relation_security,
  (
    select coalesce(
      jsonb_agg(to_jsonb(p) order by p.schemaname, p.tablename, p.policyname),
      '[]'::jsonb
    )
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array['profiles', 'workspace_members', 'workspaces'])
  ) as relation_policies;

create function migration_test.reject_fixture_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'owner CRM snapshot migration attempted to write fixture table %', tg_table_name;
end;
$$;

create trigger reject_profiles_write
before insert or update or delete or truncate on public.profiles
for each statement execute function migration_test.reject_fixture_write();
create trigger reject_workspaces_write
before insert or update or delete or truncate on public.workspaces
for each statement execute function migration_test.reject_fixture_write();
create trigger reject_workspace_members_write
before insert or update or delete or truncate on public.workspace_members
for each statement execute function migration_test.reject_fixture_write();
SQL

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration"

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
do $$
declare
  snapshot_function oid;
  is_stable boolean;
  is_invoker boolean;
  has_empty_search_path boolean;
begin
  select p.oid,
         p.provolatile = 's',
         not p.prosecdef,
         coalesce(p.proconfig @> array['search_path=""'], false)
    into snapshot_function, is_stable, is_invoker, has_empty_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'owner_crm_customer_snapshot_page'
    and p.proargtypes = '2950 23'::oidvector;

  if snapshot_function is null then
    raise exception 'owner CRM snapshot function was not created with the expected signature';
  end if;
  if not is_stable or not is_invoker or not has_empty_search_path then
    raise exception 'owner CRM snapshot execution safety attributes are incorrect';
  end if;
  if has_function_privilege('anon', snapshot_function, 'EXECUTE')
    or has_function_privilege('authenticated', snapshot_function, 'EXECUTE')
    or has_function_privilege('owner_crm_untrusted', snapshot_function, 'EXECUTE') then
    raise exception 'an untrusted role inherited owner CRM snapshot execution';
  end if;
  if not has_function_privilege('service_role', snapshot_function, 'EXECUTE') then
    raise exception 'service_role cannot execute owner CRM snapshot';
  end if;
  if exists (
    select 1
    from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = snapshot_function
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC retained owner CRM snapshot execution';
  end if;
end;
$$;

set role owner_crm_untrusted;
do $$
begin
  begin
    perform * from public.owner_crm_customer_snapshot_page(null, 1);
    raise exception 'PUBLIC-derived role unexpectedly executed owner CRM snapshot';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role anon;
do $$
begin
  begin
    perform * from public.owner_crm_customer_snapshot_page(null, 1);
    raise exception 'anon unexpectedly executed owner CRM snapshot';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role authenticated;
do $$
begin
  begin
    perform * from public.owner_crm_customer_snapshot_page(null, 1);
    raise exception 'authenticated unexpectedly executed owner CRM snapshot';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set role service_role;
do $$
declare
  ids uuid[];
  observed_count integer;
  row_record record;
begin
  select array_agg(page.workspace_id order by page.workspace_id)
    into ids
  from public.owner_crm_customer_snapshot_page(null, 2) page;
  if ids is distinct from array[
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid
  ] then
    raise exception 'first owner CRM UUID page was not bounded and ordered: %', ids;
  end if;

  select array_agg(page.workspace_id order by page.workspace_id)
    into ids
  from public.owner_crm_customer_snapshot_page(
    '20000000-0000-4000-8000-000000000002'::uuid,
    2
  ) page;
  if ids is distinct from array[
    '20000000-0000-4000-8000-000000000003'::uuid,
    '20000000-0000-4000-8000-000000000004'::uuid
  ] then
    raise exception 'owner CRM cursor page was not exclusive, bounded, and ordered: %', ids;
  end if;

  if exists (
    select 1 from public.owner_crm_customer_snapshot_page(
      '20000000-0000-4000-8000-000000000006'::uuid,
      100
    )
  ) then
    raise exception 'owner CRM cursor beyond the final UUID returned a row';
  end if;

  if (select count(*) from public.owner_crm_customer_snapshot_page(null)) <> 6
    or (select count(*) from public.owner_crm_customer_snapshot_page(null, 1)) <> 1
    or (select count(*) from public.owner_crm_customer_snapshot_page(null, 100)) <> 6 then
    raise exception 'owner CRM valid page limits did not preserve their bounds';
  end if;

  begin
    perform * from public.owner_crm_customer_snapshot_page(null, null);
    raise exception 'NULL owner CRM page limit unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform * from public.owner_crm_customer_snapshot_page(null, 0);
    raise exception 'zero owner CRM page limit unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform * from public.owner_crm_customer_snapshot_page(null, 101);
    raise exception 'oversized owner CRM page limit unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  select count(distinct page.source_observed_at)
    into observed_count
  from public.owner_crm_customer_snapshot_page(null, 100) page;
  if observed_count <> 1 then
    raise exception 'owner CRM snapshot did not report one statement observation time';
  end if;

  select * into row_record
  from public.owner_crm_customer_snapshot_page(null, 100)
  where workspace_id = '20000000-0000-4000-8000-000000000001';
  if row_record.owner_profile_id is distinct from '10000000-0000-4000-8000-000000000001'::uuid
    or row_record.owner_full_name is distinct from 'Sole Owner'
    or row_record.owner_email is distinct from 'sole-owner@example.test'
    or row_record.owner_count is distinct from 1
    or row_record.owner_profile_workspace_count is distinct from 1
    or row_record.owner_matches_created_by is distinct from true
    or row_record.billing_access_state is distinct from 'unbilled'
    or row_record.stripe_subscription_status is distinct from 'past_due'
    or row_record.trial_state is distinct from 'pending_delivery'
    or row_record.trial_started_at is not null
    or row_record.trial_ends_at is not null then
    raise exception 'sole-owner workspace facts were not mirrored exactly: %', row_to_json(row_record);
  end if;

  select * into row_record
  from public.owner_crm_customer_snapshot_page(null, 100)
  where workspace_id = '20000000-0000-4000-8000-000000000002';
  if row_record.owner_count is distinct from 0
    or row_record.owner_profile_id is not null
    or row_record.owner_full_name is not null
    or row_record.owner_email is not null
    or row_record.owner_profile_workspace_count is not null
    or row_record.owner_matches_created_by is not null then
    raise exception 'missing-owner workspace was not kept ambiguous: %', row_to_json(row_record);
  end if;

  select * into row_record
  from public.owner_crm_customer_snapshot_page(null, 100)
  where workspace_id = '20000000-0000-4000-8000-000000000003';
  if row_record.owner_count is distinct from 2
    or row_record.owner_profile_id is not null
    or row_record.owner_full_name is not null
    or row_record.owner_email is not null
    or row_record.owner_profile_workspace_count is not null
    or row_record.owner_matches_created_by is not null then
    raise exception 'multiple-owner workspace selected an arbitrary owner: %', row_to_json(row_record);
  end if;

  select * into row_record
  from public.owner_crm_customer_snapshot_page(null, 100)
  where workspace_id = '20000000-0000-4000-8000-000000000004';
  if row_record.owner_count is distinct from 1
    or row_record.owner_profile_id is distinct from '10000000-0000-4000-8000-000000000005'::uuid
    or row_record.owner_profile_workspace_count is distinct from 2
    or row_record.owner_matches_created_by is distinct from true then
    raise exception 'multi-workspace owner ambiguity facts were not preserved: %', row_to_json(row_record);
  end if;

  select * into row_record
  from public.owner_crm_customer_snapshot_page(null, 100)
  where workspace_id = '20000000-0000-4000-8000-000000000006';
  if row_record.owner_count is distinct from 1
    or row_record.owner_profile_id is distinct from '10000000-0000-4000-8000-000000000008'::uuid
    or row_record.owner_profile_workspace_count is distinct from 1
    or row_record.owner_matches_created_by is distinct from false then
    raise exception 'creator mismatch facts were not preserved conservatively: %', row_to_json(row_record);
  end if;
end;
$$;
reset role;

do $$
declare
  baseline migration_test.fixture_baseline%rowtype;
  current_profiles_digest text;
  current_workspaces_digest text;
  current_members_digest text;
  current_relation_security jsonb;
  current_relation_policies jsonb;
begin
  select * into strict baseline from migration_test.fixture_baseline;
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]'))
    into current_profiles_digest from public.profiles p;
  select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id)::text, '[]'))
    into current_workspaces_digest from public.workspaces w;
  select md5(coalesce(jsonb_agg(to_jsonb(wm) order by wm.workspace_id, wm.profile_id)::text, '[]'))
    into current_members_digest from public.workspace_members wm;
  select jsonb_agg(
      jsonb_build_object(
        'table', c.relname,
        'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'acl', coalesce(c.relacl::text, '')
      ) order by c.relname
    )
    into current_relation_security
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array['profiles', 'workspace_members', 'workspaces']);
  select coalesce(
      jsonb_agg(to_jsonb(p) order by p.schemaname, p.tablename, p.policyname),
      '[]'::jsonb
    )
    into current_relation_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = any(array['profiles', 'workspace_members', 'workspaces']);

  if current_profiles_digest is distinct from baseline.profiles_digest
    or current_workspaces_digest is distinct from baseline.workspaces_digest
    or current_members_digest is distinct from baseline.members_digest then
    raise exception 'owner CRM snapshot migration or reads changed fixture rows';
  end if;
  if current_relation_security is distinct from baseline.relation_security then
    raise exception 'owner CRM snapshot migration weakened table RLS or ACL state';
  end if;
  if current_relation_policies is distinct from baseline.relation_policies then
    raise exception 'owner CRM snapshot migration changed table RLS policies';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array['profiles', 'workspace_members', 'workspaces'])
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'owner CRM fixture table lost row-level security';
  end if;
end;
$$;
SQL

echo "Owner CRM snapshot native migration acceptance passed."
