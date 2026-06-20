-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260608214641; restored to source control here.

-- Add covering indexes for unindexed single-column FKs on public/private (small/empty
-- tables: instant, no meaningful lock). Idempotent. Big research tables handled separately
-- with CREATE INDEX CONCURRENTLY to avoid blocking the live pipeline.
do $$
declare r record; idx text;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, c.conname as conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey,1) = 1
      and n.nspname in ('public','private')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    idx := left(replace(r.conname,'_fkey',''),58) || '_fk_idx';
    execute format('create index if not exists %I on %s (%I)', idx, r.tbl, r.col);
  end loop;
end $$;
