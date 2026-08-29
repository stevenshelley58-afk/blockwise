set role postgres;
begin;

create temp table _blockwise_exact_row_counts (
  table_name text primary key,
  row_count bigint not null
) on commit drop;

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('public', 'auth', 'storage', 'private')
      and tablename <> 'blockwise_product_migration_ledger'
    order by schemaname, tablename
  loop
    execute format('select count(*) from %I.%I', r.schemaname, r.tablename) into n;
    insert into _blockwise_exact_row_counts values (format('%s.%s', r.schemaname, r.tablename), n);
  end loop;
end $$;

select coalesce(jsonb_object_agg(table_name, row_count order by table_name), '{}'::jsonb)
from _blockwise_exact_row_counts;

commit;
