-- Repoint every stored function at the renamed adbuilder tables.
--
-- WHY THIS EXISTS
--
-- 20260915000100_adbuilder_object_rename.sql renamed the ad-builder tables
-- from adstudio_* to adbuilder_* with ALTER TABLE ... RENAME, and renamed the
-- functions the same way. ALTER RENAME moves object names. It does not rewrite
-- the text of a plpgsql or sql function body, and the repository's migration
-- files were rewritten in place, so no applied migration ever re-created
-- those bodies. The live product database therefore holds nineteen functions
-- whose bodies still name tables that no longer exist:
--
--   public.reap_stale_jobs
--     v_creative_job public.adstudio_creative_jobs%rowtype;
--   public.adbuilder_persist_campaign_pack
--     from json_populate_record(null::public.adstudio_campaigns, campaign)
--   public.adbuilder_recover_provider_run
--     return public.adstudio_record_provider_run(...)
--   ... and sixteen more across public and private.
--
-- Observed on the live product database as the worker logging, once a minute:
--   reap failed: relation "public.adstudio_creative_jobs" does not exist
-- and it breaks every RPC on that list at run time: campaign pack persistence,
-- creative revisions, provider attempts and runs, and customer image uploads.
--
-- WHAT THIS DOES
--
-- Captures the live definition of every function in public and private whose
-- body references a schema-qualified adstudio_ object, rewrites exactly the
-- qualified references (public.adstudio_ and private.adstudio_) to the
-- adbuilder_ spelling, and re-executes each definition. CREATE OR REPLACE
-- keeps every OID, so grants and dependencies stay attached.
--
-- The rewrite is deliberately narrow. It touches only the qualified
-- identifier form because that is the only form the stale bodies use for
-- relations and functions. It does not touch:
--   * trial_ad_studio or ad_studio (underscore between, different word);
--   * policy names such as adstudio_workspace_select inside
--     adbuilder_install_workspace_policies. Those policies still carry the
--     adstudio_ prefix on the live tables (policy names were never renamed),
--     so the installer's drop-if-exists and create must keep naming them as
--     they are. Renaming the policies is a separate decision.
--
-- The final block refuses to leave the database half-repaired: every
-- adstudio_ token that survives must be the name of a policy that exists, and
-- every public.adbuilder_ token in every function body must resolve to a
-- relation or a function.

-- ---------------------------------------------------------------------------
-- 1. Capture the live definitions before rewriting them.
-- ---------------------------------------------------------------------------
-- pg_get_functiondef is called from a plpgsql loop rather than a query target
-- list: evaluated over pg_proc in a plain query it can reach pg_catalog rows,
-- where it raises on aggregate stubs.
drop table if exists _adstudio_table_repair_defs;
create temporary table _adstudio_table_repair_defs (
  schema_name text not null,
  function_name text not null,
  definition text not null
);

do $$
declare
  r record;
  d text;
begin
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
  loop
    d := pg_get_functiondef(r.oid);
    if strpos(d, 'public.adstudio_') > 0 or strpos(d, 'private.adstudio_') > 0 then
      insert into _adstudio_table_repair_defs (schema_name, function_name, definition)
      values (r.nspname, r.proname, d);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Every target the rewritten bodies will name must already exist. Fail
--    early rather than trade one broken name for another.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  token text;
  target text;
  missing integer := 0;
begin
  for r in select * from _adstudio_table_repair_defs loop
    for token in
      select distinct x[1]
      from regexp_matches(r.definition, '(public\.adstudio_[a-z0-9_]+|private\.adstudio_[a-z0-9_]+)', 'g') as x
    loop
      target := replace(token, 'adstudio_', 'adbuilder_');
      if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname || '.' || c.relname = target
      ) and not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname || '.' || p.proname = target
      ) then
        raise notice 'no adbuilder object for % (referenced by %.%)', token, r.schema_name, r.function_name;
        missing := missing + 1;
      end if;
    end loop;
  end loop;

  if missing > 0 then
    raise exception '% stale reference(s) have no adbuilder counterpart; nothing to repoint to', missing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite the qualified identifiers and re-create each function in place.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  fixed text;
  rewritten integer := 0;
begin
  for r in select * from _adstudio_table_repair_defs order by schema_name, function_name
  loop
    fixed := r.definition;
    fixed := replace(fixed, 'public.adstudio_', 'public.adbuilder_');
    fixed := replace(fixed, 'private.adstudio_', 'private.adbuilder_');

    if fixed = r.definition then
      continue;
    end if;

    execute fixed;
    rewritten := rewritten + 1;
    raise notice 'repointed %.% at the adbuilder tables', r.schema_name, r.function_name;
  end loop;

  raise notice 'rewrote % function definition(s) to the adbuilder table names', rewritten;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Fail loudly rather than leaving a half-repaired body behind.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  d text;
  token text;
  offenders integer := 0;
  unresolved integer := 0;
begin
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
  loop
    d := pg_get_functiondef(r.oid);

    -- No qualified reference to an adstudio_ object may survive.
    if strpos(d, 'public.adstudio_') > 0 or strpos(d, 'private.adstudio_') > 0 then
      raise notice 'still names an adstudio_ object: %.%', r.nspname, r.proname;
      offenders := offenders + 1;
    end if;

    -- Any other adstudio_ token must be the name of a policy that exists.
    for token in
      select distinct x[1]
      from regexp_matches(d, '(?<![A-Za-z0-9_.])(adstudio_[a-z0-9_]+)', 'g') as x
    loop
      if not exists (select 1 from pg_policies where policyname = token) then
        raise notice 'adstudio_ token % in %.% is not an existing policy name', token, r.nspname, r.proname;
        offenders := offenders + 1;
      end if;
    end loop;

    -- Every public.adbuilder_ token must resolve to a relation or a function.
    for token in
      select distinct x[1]
      from regexp_matches(d, '(public\.adbuilder_[a-z0-9_]+)', 'g') as x
    loop
      if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and 'public.' || c.relname = token
      ) and not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and 'public.' || p.proname = token
      ) then
        raise notice 'unresolved adbuilder reference % in %.%', token, r.nspname, r.proname;
        unresolved := unresolved + 1;
      end if;
    end loop;
  end loop;

  if offenders > 0 then
    raise exception '% function(s) still reference adstudio_ objects', offenders;
  end if;
  if unresolved > 0 then
    raise exception '% adbuilder reference(s) do not resolve to a relation or function', unresolved;
  end if;

  -- The two functions that surfaced the defect must still be present. Their
  -- compile check is done at rehearsal time inside a rolled-back transaction,
  -- because calling reap_stale_jobs here would touch live job leases.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reap_stale_jobs'
  ) then
    raise exception 'public.reap_stale_jobs disappeared during the repair';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'adbuilder_persist_campaign_pack'
  ) then
    raise exception 'public.adbuilder_persist_campaign_pack disappeared during the repair';
  end if;
end
$$;
