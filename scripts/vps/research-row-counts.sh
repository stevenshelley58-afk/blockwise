#!/bin/sh
set -eu

compose_file=${RESEARCH_COMPOSE_FILE:-infra/coolify/docker-compose.research.yml}
project_dir=${BLOCKWISE_PROJECT_DIR:-/opt/blockwise}

cd "$project_dir"

docker compose -f "$compose_file" exec -T research-db \
  psql -U postgres -d blockwise_research -X -At <<'SQL'
select jsonb_object_agg(table_name, row_count order by table_name)
from (
  select
    c.relname as table_name,
    (xpath(
      '/row/count/text()',
      query_to_xml(
        format('select count(*) as count from research.%I', c.relname),
        false,
        true,
        ''
      )
    ))[1]::text::bigint as row_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'research'
    and c.relkind = 'r'
) counts;
SQL
