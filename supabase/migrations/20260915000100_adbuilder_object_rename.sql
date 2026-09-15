-- Ad Builder rename: move every remaining ad-studio-era database object name
-- onto the Ad Builder naming convention.
--
-- Why this migration exists: the product surface, routes, code and schema were
-- renamed onto the Ad Builder naming convention in one cutover. The app is not
-- live, so no second name is kept at the product level.
--
-- Migration *filenames* are the one deliberate exception. That is not a second
-- product name: it protects the live database.
-- scripts/vps/product-migrate.sh records progress in
-- public.blockwise_product_migration_ledger keyed on the filename, so renaming
-- a file that is already applied makes the runner treat it as new and execute
-- it again. Every already-applied migration therefore keeps its original
-- filename as a frozen ledger key, and no filename needs to change for the
-- product to read and write the new names.
--
-- This migration is what actually moves the schema. Object names *inside* the
-- historical files already use the new spelling, so a fresh install creates the
-- final names directly and this migration finds nothing to do. A database that
-- predates the rename still carries the old object names, and this migration
-- renames them in place, which is the path the live product database takes.
--
-- ALTER ... RENAME keeps OIDs, so data, primary keys, foreign keys, indexes,
-- row level security policies, grants and trigger bindings all survive. It is
-- therefore non-destructive and needs no backfill. The final assertion aborts
-- the transaction if any old name is left, so a silent partial rename cannot
-- reach production. The migration runner wraps this file in a transaction.

-- Rename every base table in public whose name carries the old prefix.
do $$
declare
  rec record;
begin
  for rec in
    select c.relname as old_name, replace(c.relname, 'adstudio', 'adbuilder') as new_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like '%adstudio%'
  loop
    execute format('alter table public.%I rename to %I', rec.old_name, rec.new_name);
    raise notice 'renamed table public.% to %', rec.old_name, rec.new_name;
  end loop;
end
$$;

-- Column names follow the tables. A missing pair is tolerated so that a
-- database which already ran the new spelling, or never had the column, is
-- still a no-op rather than a failure.
do $$
declare
  rec record;
begin
  for rec in
    select table_schema, table_name, column_name,
           replace(column_name, 'adstudio', 'adbuilder') as new_name
    from information_schema.columns
    where table_schema = 'public' and column_name like '%adstudio%'
  loop
    begin
      execute format('alter table %I.%I rename column %I to %I',
                     rec.table_schema, rec.table_name, rec.column_name, rec.new_name);
      raise notice 'renamed column %.%.% to %',
        rec.table_schema, rec.table_name, rec.column_name, rec.new_name;
    exception
      when undefined_table or undefined_column then null;
    end;
  end loop;
end
$$;

-- Stored procedures and functions, in public and private. Aggregate functions
-- keep their own rename syntax and are skipped: none exist under this prefix.
do $$
declare
  rec record;
begin
  for rec in
    select n.nspname as schema_name, p.proname as old_name,
           replace(p.proname, 'adstudio', 'adbuilder') as new_name,
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname like '%adstudio%'
      and p.prokind <> 'a'
  loop
    execute format('alter function %I.%I(%s) rename to %I',
                   rec.schema_name, rec.old_name, rec.identity_args, rec.new_name);
    raise notice 'renamed function %.% to %', rec.schema_name, rec.old_name, rec.new_name;
  end loop;
end
$$;

-- Constraint names carry the old table name into primary keys, foreign keys and
-- check constraints. Constraint-backed indexes follow their constraint.
do $$
declare
  rec record;
begin
  for rec in
    select conrelid::regclass as table_name, conname as old_name,
           replace(conname, 'adstudio', 'adbuilder') as new_name
    from pg_constraint
    where connamespace = 'public'::regnamespace and conname like '%adstudio%'
  loop
    begin
      execute format('alter table %s rename constraint %I to %I',
                     rec.table_name, rec.old_name, rec.new_name);
      raise notice 'renamed constraint % on % to %', rec.old_name, rec.table_name, rec.new_name;
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$$;

-- Standalone indexes that are not owned by a constraint.
do $$
declare
  rec record;
begin
  for rec in
    select schemaname, indexname as old_name,
           replace(indexname, 'adstudio', 'adbuilder') as new_name
    from pg_indexes
    where schemaname = 'public' and indexname like '%adstudio%'
  loop
    begin
      execute format('alter index %I.%I rename to %I',
                     rec.schemaname, rec.old_name, rec.new_name);
      raise notice 'renamed index %.% to %', rec.schemaname, rec.old_name, rec.new_name;
    exception
      when duplicate_table then null;
    end;
  end loop;
end
$$;

-- Triggers defined directly on a table (not constraint triggers).
do $$
declare
  rec record;
begin
  for rec in
    select tgrelid::regclass as table_name, tgname as old_name,
           replace(tgname, 'adstudio', 'adbuilder') as new_name
    from pg_trigger
    where not tgisinternal and tgname like '%adstudio%'
  loop
    begin
      execute format('alter trigger %I on %s rename to %I',
                     rec.old_name, rec.table_name, rec.new_name);
      raise notice 'renamed trigger % on % to %', rec.old_name, rec.table_name, rec.new_name;
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$$;

-- Fail loudly rather than leaving a half-renamed schema behind. Any surviving
-- old name means the code that now reads the Ad Builder names would miss it.
do $$
declare
  leftover text;
begin
  select string_agg(item, ', ' order by item) into leftover
  from (
    select 'table public.' || c.relname as item
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like '%adstudio%'
    union all
    select 'column ' || table_schema || '.' || table_name || '.' || column_name
    from information_schema.columns
    where table_schema = 'public' and column_name like '%adstudio%'
    union all
    select 'routine ' || n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname like '%adstudio%'
    union all
    select 'constraint ' || conname
    from pg_constraint
    where connamespace = 'public'::regnamespace and conname like '%adstudio%'
    union all
    select 'index ' || schemaname || '.' || indexname
    from pg_indexes
    where schemaname = 'public' and indexname like '%adstudio%'
    union all
    select 'trigger ' || tgname
    from pg_trigger
    where not tgisinternal and tgname like '%adstudio%'
  ) leftovers;

  if leftover is not null then
    raise exception 'Ad Builder rename incomplete, old names remain: %', leftover;
  end if;
end
$$;
