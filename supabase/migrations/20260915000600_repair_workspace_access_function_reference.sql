-- Repair two functions that call a private helper which does not exist.
--
-- WHY THIS EXISTS
--
-- private.adbuilder_has_workspace_access(uuid) is the workspace access predicate
-- that the ad-builder RLS policies are built on. The ad-studio rename renamed
-- the policies and rewrote some of the text that mentions the helper, but it
-- never renamed the helper itself, and it left two function bodies calling the
-- new spelling:
--
--   public.commit_ad_revision                    (the ad save path)
--     and not private.adstudio_has_workspace_access(p_workspace_id) then
--   public.adbuilder_install_workspace_policies
--     execute format('create policy adstudio_workspace_select on %s
--                     for select using (private.adstudio_has_workspace_access(workspace_id))', ...)
--
-- private.adstudio_has_workspace_access(uuid) does not exist in any schema, so
-- both functions raise at run time:
--
--   ERROR: function private.adstudio_has_workspace_access(uuid) does not exist
--
-- Observed on the live product database and reproduced on the isolated stack,
-- where it surfaced in the customer editor as:
--   "Check this before continuing function
--    private.adstudio_has_workspace_access(uuid) does not exist"
-- when a customer pressed Save on an ad.
--
-- The repository is unambiguously on the other spelling. `grep -rn
-- adstudio_has_workspace_access` over the whole worktree returns nothing, while
-- 20260608223012_authz_step2_repoint_policies_and_drop_public_helpers.sql and
-- 20260829010000_adstudio_transactional_writes.sql both call
-- private.adbuilder_has_workspace_access. So production has drifted from the
-- repository, not the other way round.
--
-- A FALSE TRAIL, RECORDED SO IT IS NOT RE-WALKED
--
-- Searching policies for 'adstudio_has_workspace_access' also matches two
-- healthy policies, because they alias the result column:
--   using ( select private.adbuilder_has_workspace_access(workspace_id)
--           as adstudio_has_workspace_access )
-- That alias is not a call. Search for the call form, with the parenthesis:
-- 'adstudio_has_workspace_access('.
--
-- WHAT THIS DOES
--
-- Rewrites exactly that identifier inside the two function bodies, using their
-- live definitions, and nothing else. CREATE OR REPLACE keeps each function's
-- OID, so grants and any dependency stay attached. This is deliberately
-- surgical: the bodies are otherwise left byte-for-byte as they are in
-- production, so the only behavioural change is that the helper resolves.

-- ---------------------------------------------------------------------------
-- 1. Capture the live definitions before rewriting them.
-- ---------------------------------------------------------------------------
-- pg_get_functiondef is called from a plpgsql loop rather than a query target
-- list: evaluated over pg_proc in a plain query it can reach pg_catalog rows,
-- where it raises on aggregate stubs.
drop table if exists _workspace_access_repair_defs;
create temporary table _workspace_access_repair_defs (
  schema_name text not null,
  function_name text not null,
  definition text not null
);

do $$
declare
  r record;
begin
  -- The test is made inside the loop body, never in the query's WHERE clause.
  -- pg_get_functiondef evaluated as part of a query can reach pg_catalog rows,
  -- where it raises 'array_agg is an aggregate function' and aborts the block.
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
  loop
    if strpos(pg_get_functiondef(r.oid), 'adstudio_has_workspace_access(') > 0 then
      insert into _workspace_access_repair_defs (schema_name, function_name, definition)
      values (r.nspname, r.proname, pg_get_functiondef(r.oid));
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The helper the rewritten calls must resolve to. Fail early if it is
--    missing, because then the rewrite below would only trade one broken name
--    for another.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'adbuilder_has_workspace_access'
  ) then
    raise exception 'private.adbuilder_has_workspace_access(uuid) is missing; nothing to repoint to';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite the identifier.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  fixed text;
  rewritten integer := 0;
begin
  for r in select * from _workspace_access_repair_defs order by schema_name, function_name
  loop
    fixed := replace(
      r.definition,
      'adstudio_has_workspace_access(',
      'adbuilder_has_workspace_access('
    );

    if fixed = r.definition then
      continue;
    end if;

    execute fixed;
    rewritten := rewritten + 1;
    raise notice 'repointed %.% to private.adbuilder_has_workspace_access', r.schema_name, r.function_name;
  end loop;

  raise notice 'rewrote % function definition(s)', rewritten;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Fail loudly rather than leaving a half-repaired call behind.
-- ---------------------------------------------------------------------------
do $$
declare
  offenders integer := 0;
  r record;
begin
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
  loop
    if strpos(pg_get_functiondef(r.oid), 'adstudio_has_workspace_access(') > 0 then
      raise notice 'still calls the missing helper: %.%', r.nspname, r.proname;
      offenders := offenders + 1;
    end if;
  end loop;

  if offenders > 0 then
    raise exception '% function(s) still call private.adstudio_has_workspace_access', offenders;
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'commit_ad_revision'
  ) then
    raise exception 'public.commit_ad_revision disappeared during the repair';
  end if;
end
$$;
