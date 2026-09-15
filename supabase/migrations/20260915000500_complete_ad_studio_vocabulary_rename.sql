-- Complete the ad-studio vocabulary rename in databases that predate it.
--
-- WHY THIS EXISTS
--
-- 20260915000200_ad_studio_trial_signup_rename.sql moved exactly two objects:
-- the trigger auth.users.on_trial_self_serve_signup and the function
-- public.handle_trial_self_serve_signup. ALTER ... RENAME moves names. It does
-- not rewrite string literals, and it never touched the workspace_mode enum.
--
-- The repository, meanwhile, was rewritten to the new vocabulary. The frozen
-- migration 202605260001_initial_blockwise.sql now declares
--     create type public.workspace_mode as enum ('monitor', 'ad_studio');
-- and src/lib/auth/access-control.ts declares
--     export type WorkspaceMode = "monitor" | "ad_studio";
-- `grep -rn self_serve src/` returns nothing.
--
-- So a fresh install speaks ad_studio, and a database that predates the rename
-- speaks both vocabularies at once. Verified on the live product database:
--
--   enum labels containing self_serve ..... workspace_mode.self_serve
--   workspaces ............................ 6, every one mode = 'self_serve'
--   user functions containing self_serve .. 6
--     private.capture_ad_radar_signup_interest
--         if coalesce(v_metadata->>'signup_flow', '') <> 'trial_self_serve'
--     private.provision_workspace_activation_foundation
--         if new.mode <> 'self_serve'
--     public.accept_verified_workspace_invitations
--         if v_workspace_mode <> 'self_serve'
--     public.bootstrap_verified_trial_workspace
--         and w.mode = 'self_serve' / 'self_serve', / <> 'trial_self_serve'
--     public.reserve_verified_workspace_invitation
--         if v_workspace_mode <> 'self_serve'
--     public.start_trial_on_first_delivery
--         and w.mode = 'self_serve'
--
-- WHY IT SURFACED ONLY NOW
--
-- The two defects masked each other. bootstrap_verified_trial_workspace returned
-- early at its signup_flow gate, so the insert that names the enum value was
-- never reached and the invalid label never raised. 20260915000400 repairs that
-- gate; the next thing the function does is insert mode = 'self_serve', so the
-- gate repair alone converts a silent no-op into a hard failure. Both halves
-- have to land together.
--
-- CONSEQUENCES WHILE UNREPAIRED
--
--   * The trial cannot start at all. Once the gate passes, the bootstrap RPC
--     aborts with: invalid input value for enum public.workspace_mode: "ad_studio"
--   * Every existing workspace is misclassified. src/lib/auth/workspace-access.ts
--     maps mode === "ad_studio" ? "ad_studio" : "monitor", and
--     src/components/app-shell.tsx skips the trial status card entirely when the
--     mode is not "ad_studio". With mode = 'self_serve' no workspace is ever
--     "ad_studio", so the ad-studio trial surface never renders its status.
--
-- WHAT THIS DOES
--
--   1. rename the enum label self_serve -> ad_studio
--      ALTER TYPE ... RENAME VALUE rewrites the catalogue in place and keeps
--      every stored row, so the 6 live workspaces are preserved and become valid.
--   2. rewrite the two literals inside the 6 functions above
--      CREATE OR REPLACE keeps each function's OID, so its grants and any
--      trigger bound to it stay attached.
--
-- ORDERING
--
-- The definitions are captured BEFORE the label moves, because a SQL-language
-- body would no longer resolve once its literal named a label that no longer
-- exists. Everything runs in a single transaction, so no session ever observes
-- a half-renamed vocabulary.
--
-- WHAT THIS DELIBERATELY LEAVES ALONE
--
--   * public.page_views.path (180 rows) carries self_serve inside historical
--     URLs. That records what was actually requested at the time; rewriting it
--     would falsify analytics history.
--   * blockwise_product_migration_ledger.version holds the frozen key
--     202606040004_self_serve_trial.sql. Ledger filenames are never rewritten.

-- ---------------------------------------------------------------------------
-- 1. Capture the definitions that need rewriting, before the label moves.
-- ---------------------------------------------------------------------------
-- pg_get_functiondef is called from a plpgsql loop rather than from a query
-- target list: evaluated over pg_proc in a plain query it can be applied to
-- pg_catalog rows, where it raises on aggregate stubs.
-- No ON COMMIT DROP here: migrations are applied statement by statement, so
-- each statement is its own transaction and the table would be dropped the
-- instant it was created. A session-scoped temp table is what we want.
drop table if exists _ad_studio_repair_defs;
create temporary table _ad_studio_repair_defs (
  schema_name text not null,
  function_name text not null,
  definition text not null
);

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and (n.nspname, p.proname) in (
        ('private', 'capture_ad_radar_signup_interest'),
        ('private', 'provision_workspace_activation_foundation'),
        ('public', 'accept_verified_workspace_invitations'),
        ('public', 'bootstrap_verified_trial_workspace'),
        ('public', 'reserve_verified_workspace_invitation'),
        ('public', 'start_trial_on_first_delivery')
      )
  loop
    insert into _ad_studio_repair_defs (schema_name, function_name, definition)
    values (r.nspname, r.proname, pg_get_functiondef(r.oid));
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Move the enum label. Idempotent, and a no-op on a database that already
--    speaks ad_studio (a fresh install from 202605260001 never sees self_serve).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'workspace_mode' and e.enumlabel = 'self_serve'
  ) and not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'workspace_mode' and e.enumlabel = 'ad_studio'
  ) then
    alter type public.workspace_mode rename value 'self_serve' to 'ad_studio';
    raise notice 'renamed enum label public.workspace_mode.self_serve -> ad_studio';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite the literals. Longest literal first: 'trial_self_serve' must not be
--    half-replaced into 'trial_ad_studio' by the shorter rule.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  fixed text;
  rewritten integer := 0;
begin
  for r in select * from _ad_studio_repair_defs order by schema_name, function_name
  loop
    fixed := r.definition;
    fixed := replace(fixed, '''trial_self_serve''', '''trial_ad_studio''');
    fixed := replace(fixed, '''self_serve''', '''ad_studio''');

    -- A function already on the new vocabulary is left alone. This is not
    -- hypothetical: 20260915000400 redefines bootstrap_verified_trial_workspace
    -- from the repository text, which already says ad_studio, so by the time
    -- this migration runs that one has nothing left to rewrite. The guarantee
    -- that matters is the assertion in section 4, not a count here.
    if fixed = r.definition then
      continue;
    end if;

    execute fixed;
    rewritten := rewritten + 1;
  end loop;

  raise notice 'rewrote % function definition(s) to the ad_studio vocabulary', rewritten;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Fail loudly rather than leaving a half-renamed vocabulary behind.
-- ---------------------------------------------------------------------------
do $$
declare
  leftover text;
  offenders integer := 0;
  r record;
  label_count integer;
begin
  -- no enum label anywhere may still say self_serve
  select string_agg(t.typname || '.' || e.enumlabel, ', ' order by 1)
    into leftover
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where e.enumlabel like '%self_serve%';

  if leftover is not null then
    raise exception 'enum labels still carry the old vocabulary: %', leftover;
  end if;

  -- and the target label must exist
  select count(*) into label_count
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'workspace_mode' and e.enumlabel = 'ad_studio';

  if label_count <> 1 then
    raise exception 'public.workspace_mode has no ad_studio label';
  end if;

  -- no user function may still reference it
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
  loop
    if strpos(pg_get_functiondef(r.oid), 'self_serve') > 0 then
      raise notice 'still references self_serve: %.%', r.nspname, r.proname;
      offenders := offenders + 1;
    end if;
  end loop;

  if offenders > 0 then
    raise exception '% function(s) still reference self_serve', offenders;
  end if;

  -- the trial gate that started all of this must read the new value
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'bootstrap_verified_trial_workspace'
      and strpos(pg_get_functiondef(p.oid), '''trial_ad_studio''') > 0
  ) then
    raise exception 'bootstrap_verified_trial_workspace does not gate on trial_ad_studio';
  end if;
end
$$;
