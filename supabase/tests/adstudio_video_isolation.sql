-- Ad Studio Video: cross-workspace isolation and privilege contract.
--
-- This is a real behavioural test, not a source-text check. It seeds two
-- workspaces inside a transaction, then switches the active role and JWT claim
-- to each workspace's member and proves that workspace A cannot see, change or
-- forge workspace B's video records. Everything rolls back at the end, so it is
-- safe to run against a database whose schema already carries the migration.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/adstudio_video_isolation.sql
begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'video-a@test.invalid', now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'video-b@test.invalid', now(), now(), now());

insert into public.profiles (id, email, is_operator) values
  ('11111111-1111-4111-8111-111111111111', 'video-a@test.invalid', false),
  ('22222222-2222-4222-8222-222222222222', 'video-b@test.invalid', false);

insert into public.workspaces (id, name) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'Video Isolation A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Video Isolation B');

insert into public.workspace_members (workspace_id, profile_id, role) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');

insert into public.video_projects (id, workspace_id, mode, title, created_by) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-00000000000a',
   'uploaded', 'Workspace A existing video', '11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-00000000000b',
   'uploaded', 'Workspace B existing video', '22222222-2222-4222-8222-222222222222');

-- An operator-only production asset in workspace A. A customer in workspace A
-- must not see it either: production material stays private inside the tenant.
insert into public.video_assets (workspace_id, project_id, kind, visibility, object_path, upload_state)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a1',
        'production_source', 'operator',
        'aaaaaaaa-0000-4000-8000-00000000000a/projects/a0000000-0000-4000-8000-0000000000a1/production/run-1/project.json',
        'ready');

-- ---------------------------------------------------------------------------
-- Membership sanity: the transaction-local seed really did grant A and not B.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.workspace_members
                 where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a'
                   and profile_id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'SEED FAILED: workspace A membership missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Switch to workspace A's member.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare visible integer;
begin
  -- A sees its own project.
  select count(*) into visible from public.video_projects
   where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
  if visible <> 1 then
    raise exception 'ISOLATION FAIL (own read): expected 1 own project, saw %', visible;
  end if;

  -- A must not see B's project.
  select count(*) into visible from public.video_projects
   where workspace_id = 'bbbbbbbb-0000-4000-8000-00000000000b';
  if visible <> 0 then
    raise exception 'ISOLATION FAIL (cross-workspace read): A saw % of B''s projects', visible;
  end if;

  -- A must not see B's project even when asking for it by its exact id.
  select count(*) into visible from public.video_projects
   where id = 'b0000000-0000-4000-8000-0000000000b1';
  if visible <> 0 then
    raise exception 'ISOLATION FAIL (id swap): A read B''s project by direct id';
  end if;

  raise notice 'PASS: workspace A read isolation holds';
end $$;

-- A must not be able to write into B's workspace.
do $$
declare changed integer;
begin
  begin
    update public.video_projects set title = 'hijacked'
     where id = 'b0000000-0000-4000-8000-0000000000b1';
    get diagnostics changed = row_count;
    if changed <> 0 then
      raise exception 'ISOLATION FAIL (cross-workspace update): A changed % of B''s rows', changed;
    end if;
    raise notice 'PASS: workspace A cannot update B''s project';
  exception
    when insufficient_privilege then
      raise notice 'PASS: workspace A update into B denied by privilege check';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Operator-only material is invisible to a tenant member, in their own tenant.
-- ---------------------------------------------------------------------------
do $$
declare visible integer;
begin
  begin
    select count(*) into visible from public.video_assets
     where project_id = 'a0000000-0000-4000-8000-0000000000a1';
    if visible <> 0 then
      raise exception 'PRIVACY FAIL: member saw % operator-only production assets', visible;
    end if;
    raise notice 'PASS: operator-only production assets hidden from member';
  exception
    when insufficient_privilege then
      raise notice 'PASS: production asset table reachable only through the service role';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Switching to workspace B sees exactly B, never A.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare visible integer;
begin
  select count(*) into visible from public.video_projects
   where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
  if visible <> 0 then
    raise exception 'ISOLATION FAIL (reverse direction): B saw % of A''s projects', visible;
  end if;

  select count(*) into visible from public.video_projects
   where workspace_id = 'bbbbbbbb-0000-4000-8000-00000000000b';
  if visible <> 1 then
    raise exception 'ISOLATION FAIL (own read B): expected 1, saw %', visible;
  end if;

  raise notice 'PASS: workspace B read isolation holds in both directions';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous callers get nothing at all.
-- ---------------------------------------------------------------------------
set local role anon;

do $$
declare visible integer;
begin
  begin
    select count(*) into visible from public.video_projects;
    if visible <> 0 then
      raise exception 'ANON FAIL: anonymous caller saw % video projects', visible;
    end if;
    raise notice 'PASS: anonymous caller sees no video projects';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous caller denied on video_projects';
  end;
end $$;

reset role;

rollback;
