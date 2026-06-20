-- Operator Database Viewer: schema introspection RPC.
--
-- The PostgREST data API does not expose information_schema, so the operator
-- DB viewer needs a SECURITY DEFINER function to enumerate public base tables
-- and their columns. Read/write of row data still goes through PostgREST under
-- the service role; this function only returns *metadata* (no row contents).
--
-- Execution is granted to service_role only — the operator API calls it via the
-- service client after requireOperator() has authorised the caller.

create or replace function public.operator_db_schema()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'name', c.table_name,
      'approx_rows', coalesce(
        (select pc.reltuples::bigint
           from pg_class pc
           join pg_namespace pn on pn.oid = pc.relnamespace
          where pn.nspname = 'public' and pc.relname = c.table_name),
        0),
      'columns', jsonb_agg(
        jsonb_build_object(
          'name', c.column_name,
          'type', c.data_type,
          'nullable', (c.is_nullable = 'YES'),
          'has_default', (c.column_default is not null),
          'position', c.ordinal_position
        ) order by c.ordinal_position)
    ) as t
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in (
        select table_name
          from information_schema.tables
         where table_schema = 'public'
           and table_type = 'BASE TABLE'
      )
    group by c.table_name
  ) s;
$$;

revoke all on function public.operator_db_schema() from public;
revoke all on function public.operator_db_schema() from anon;
revoke all on function public.operator_db_schema() from authenticated;
grant execute on function public.operator_db_schema() to service_role;

comment on function public.operator_db_schema() is
  'Operator DB viewer metadata: public base tables + columns. Service-role only. Returns schema metadata, never row data.';
