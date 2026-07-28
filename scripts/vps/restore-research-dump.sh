#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <research-schema.sql> <research-data.sql>" >&2
  exit 64
fi

schema_dump=$1
data_dump=$2
compose_file=${RESEARCH_COMPOSE_FILE:-infra/coolify/docker-compose.research.yml}
project_dir=${BLOCKWISE_PROJECT_DIR:-/opt/blockwise}

case "$schema_dump" in
  /*) ;;
  *) schema_dump="$project_dir/$schema_dump" ;;
esac
case "$data_dump" in
  /*) ;;
  *) data_dump="$project_dir/$data_dump" ;;
esac

for file in "$schema_dump" "$data_dump"; do
  if [ ! -f "$file" ]; then
    echo "missing dump: $file" >&2
    exit 66
  fi
done

cd "$project_dir"

existing_tables=$(
  docker compose -f "$compose_file" exec -T research-db \
    psql -U postgres -d blockwise_research -Atc \
    "select count(*) from pg_tables where schemaname = 'research'"
)

if [ "$existing_tables" != "0" ]; then
  echo "refusing to restore into a non-empty research schema ($existing_tables tables)" >&2
  exit 65
fi

docker compose -f "$compose_file" stop hermes research-rest research-gateway >/dev/null 2>&1 || true

docker compose -f "$compose_file" exec -T research-db \
  psql -U postgres -d blockwise_research -v ON_ERROR_STOP=1 < "$schema_dump"

docker compose -f "$compose_file" exec -T research-db \
  psql -U postgres -d blockwise_research -v ON_ERROR_STOP=1 < "$data_dump"

docker compose -f "$compose_file" exec -T research-db \
  psql -U postgres -d blockwise_research -v ON_ERROR_STOP=1 <<'SQL'
drop table if exists research.owned_ad_performance;
drop table if exists public.adstudio_creatives;
drop table if exists public.adstudio_campaigns;
drop table if exists public.workspaces;

revoke all on schema research from anon, authenticated;
revoke all on all tables in schema research from anon, authenticated;
revoke all on all sequences in schema research from anon, authenticated;
revoke all on all functions in schema research from anon, authenticated;

grant usage on schema research to service_role;
grant all on all tables in schema research to service_role;
grant all on all sequences in schema research to service_role;
grant execute on all functions in schema research to service_role;

alter default privileges for role postgres in schema research
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema research
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema research
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema research
  grant all on tables to service_role;
alter default privileges for role postgres in schema research
  grant all on sequences to service_role;
alter default privileges for role postgres in schema research
  grant execute on functions to service_role;

analyze;
SQL

docker compose -f "$compose_file" up -d research-rest research-gateway

echo "research restore completed; Hermes remains stopped for verification"
