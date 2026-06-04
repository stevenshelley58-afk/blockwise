# Hermes — Go-Live Handoff

_2026-06-03 · Perth-first restore_

The complete build is committed locally and the prod schema is ready. **Two steps remain that I can't do from here** (no GitHub creds in the sandbox, no VPS SSH): push + redeploy.

## Already done (verified)
- **Git repaired** — both the ref corruption and a second index corruption — and rebuilt to a healthy state. Backup tag `backup/ads-live-pre-hermes-1780449877` (reset there to undo the whole merge).
- **Complete build committed to `ads-live`:**
  - `b4e2315` — fixed supervisor (national-postcode loading, `blockwise-coverage-auditor` + `blockwise-defect-investigator` handlers, ad-inactivity reconciliation, unresolved-page + stale-agency watchdogs, media-URL refresh), operator dashboard + kill-switch/refresh routes + sidebar/agents nav, audit-trail migration.
  - `8c3feb5` — held the national seed out of auto-apply (Perth-first).
- **Prod migration applied:** `research.ingest_events` audit columns (`202606020002`).
- **National seed corrected & held:** re-encoded UTF-8 and widened the priority `CHECK` to 1..6 (it was UTF-16 with priority-6 rows that violated `CHECK 1..5` — would have failed). Now parked at `ops/national-rollout/` so a `db push` won't crawl all 2,845 postcodes.
- **Operator access:** `operator@blockwise.test` is already `is_operator` (there's no `stevenshelley58@gmail.com` account — you sign in via the `@blockwise.test` logins).

## Step 1 — Push (from your machine, where git is authenticated)
```bash
git push origin ads-live   # 3 commits ahead: 9c59117, b4e2315, 8c3feb5
```

## Step 2 — Redeploy Hermes on the VPS
`/opt/blockwise` is **not** a git checkout, and the compose build needs env vars, so a manual `git pull` won't work. Use the purpose-built cutover script — it clones the repo fresh, **preserves your existing `.env`**, writes the full compose env (`BLOCKWISE_RESEARCH_RUNTIME_ENABLED=true`, `HERMES_RESEARCH_MODE=maintain`, the 25 Perth postcodes), and rebuilds. It does **not** touch Supabase data.

> ⚠️ Do **not** run `scripts/vps/research-hard-reset-deploy.sh` — that's a HARD RESET of the research schema. `vps-runtime-cutover.sh` is the safe one.

On the VPS as root (the supervisor is baked into the image at build, so this must be **after** the push):
```bash
cd /opt/blockwise
# confirm the secrets file is present — these 7 names must appear:
grep -oE '^[A-Z_]+=' .env | tr -d = | sort | tr '\n' ' '; echo
#   need: SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY MEM0_API_KEY
#         BROWSERBASE_API_KEY BROWSERBASE_PROJECT_ID HERMES_WEBHOOK_SECRET

DEPLOY_REF=ads-live bash scripts/vps/vps-runtime-cutover.sh
```
(The VPS needs git access to the private repo for the clone; it was deployed before, so it likely already has a deploy key/token.)

## SSH Sync Path If The Session Expired
If the live SSH session expires before a Git push/cutover, sync the changed
runtime files directly from your workstation:

```bash
VPS_SSH_TARGET=root@<vps-host>
ssh "$VPS_SSH_TARGET" 'mkdir -p /opt/blockwise/hermes/tools/research-runtime/bin /opt/blockwise/infra/coolify /opt/blockwise/infra/hermes /opt/blockwise/scripts/vps /opt/blockwise/supabase/migrations'
scp hermes/tools/research-runtime/bin/supabase-supervisor.mjs "$VPS_SSH_TARGET":/opt/blockwise/hermes/tools/research-runtime/bin/supabase-supervisor.mjs
scp infra/coolify/docker-compose.research.yml "$VPS_SSH_TARGET":/opt/blockwise/infra/coolify/docker-compose.research.yml
scp infra/hermes/Dockerfile "$VPS_SSH_TARGET":/opt/blockwise/infra/hermes/Dockerfile
scp infra/hermes/hermes.toml "$VPS_SSH_TARGET":/opt/blockwise/infra/hermes/hermes.toml
scp infra/hermes/main-wrapper.sh "$VPS_SSH_TARGET":/opt/blockwise/infra/hermes/main-wrapper.sh
scp scripts/vps/vps-runtime-cutover.sh "$VPS_SSH_TARGET":/opt/blockwise/scripts/vps/vps-runtime-cutover.sh
scp scripts/vps/deploy-migrations.sh "$VPS_SSH_TARGET":/opt/blockwise/scripts/vps/deploy-migrations.sh
scp supabase/migrations/202606030003_zero_ad_item_count_contract.sql "$VPS_SSH_TARGET":/opt/blockwise/supabase/migrations/202606030003_zero_ad_item_count_contract.sql
ssh "$VPS_SSH_TARGET" 'cd /opt/blockwise && chmod +x scripts/vps/*.sh infra/hermes/main-wrapper.sh && docker compose --env-file .env -f infra/coolify/docker-compose.research.yml config --quiet && docker compose --env-file .env -f infra/coolify/docker-compose.research.yml up -d --build hermes uptime-kuma'
```

Then apply the zero-ad watchdog migration against Supabase from any shell that
has `SUPABASE_DB_URL` and `psql`:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202606030003_zero_ad_item_count_contract.sql
```

Confirm the new code is live:
```bash
docker exec blockwise-hermes wc -l /app/research-runtime/bin/supabase-supervisor.mjs   # expect 2969
curl -fsS http://127.0.0.1:8642/health
```

## Step 3 — Verify
```bash
docker compose -f infra/coolify/docker-compose.research.yml ps
curl -fsS  http://127.0.0.1:8642/health
curl -fsSI http://127.0.0.1:9119/
```
Then ping me — I'll check (read-only, via your Supabase) that `work_queue` is moving, new `observed_ads` / `ingest_events` are landing, and `/operator/research` renders.

## Step 4 — Later: go national
When Perth looks healthy, apply `ops/national-rollout/202606020001_seed_national_postcodes.sql` (or just tell me and I'll apply it). Seeds ~2,845 postcodes by priority; spend capped at $25/day.
