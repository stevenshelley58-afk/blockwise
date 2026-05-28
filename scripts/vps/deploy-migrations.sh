#!/usr/bin/env bash
# scripts/vps/deploy-migrations.sh
#
# Apply the research engine migrations to the Supabase project.
# Run from your laptop or CI runner — NOT from the VPS.
#
# Requires:
#   - supabase CLI installed locally
#   - SUPABASE_DB_URL exported (postgresql://postgres:<service-role-pw>@db.<ref>.supabase.co:5432/postgres)
#   OR
#   - supabase link to the project already done

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ -z "${SUPABASE_DB_URL:-}" ] && [ ! -f supabase/.temp/linked-project.json ]; then
  echo "Either export SUPABASE_DB_URL or run 'supabase link' first." >&2
  exit 1
fi

if command -v supabase >/dev/null 2>&1; then
  echo "[migrations] applying via supabase CLI"
  supabase db push --include-all
else
  echo "[migrations] supabase CLI not found; falling back to psql"
  command -v psql >/dev/null 2>&1 || { echo "psql is required for the fallback path"; exit 1; }
  for f in \
    supabase/migrations/202605280002_research_drop_legacy.sql \
    supabase/migrations/202605280003_research_engine.sql \
    supabase/migrations/202605280004_research_views.sql; do
    echo "[migrations] $f"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
fi

echo "[migrations] done"
