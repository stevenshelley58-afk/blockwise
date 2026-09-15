-- Managed rename: move the persisted workspace flag off the old "managed
-- service" wording so the schema reads the same as the product copy.
--
-- The applied baseline keeps its frozen filename as a ledger key, so the column
-- is defined with the new name inside 202605260001_initial_blockwise.sql and a
-- fresh install creates it directly. A database that predates the rename still
-- has the old column name, and this migration renames it in place.
--
-- ALTER ... RENAME COLUMN keeps the table OID and every dependent object, so
-- the NOT NULL constraint, the default and any index or policy survive. The
-- final assertion aborts the transaction if the old name is left behind.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'managed_service_enabled'
  ) then
    alter table public.workspaces rename column managed_service_enabled to managed_enabled;
    raise notice 'renamed column public.workspaces.managed_service_enabled';
  end if;
end
$$;

do $$
declare
  leftover text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
    into leftover
  from information_schema.columns
  where table_schema = 'public' and column_name like '%managed_service%';

  if leftover is not null then
    raise exception 'Managed rename incomplete, old column names remain: %', leftover;
  end if;
end
$$;
