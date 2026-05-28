# Hermes Research Engine — Go-Live Runbook

This is the operator playbook to take the engine from `feature/hermes-research-engine`
to **live and collecting ads**. Do the steps in order. None of them are reversible
in a damaging way as long as you do step 1 first.

---

## Pre-flight

You will need:

- root access to the VPS at `76.13.209.160`
- a working `ssh` from your laptop (key authentication preferred)
- the Supabase project's service-role key
- credentials for: Apify, OpenRouter, mem0, Browserbase
- domain `blockwise.sale` already in Cloudflare (✓ confirmed)

Budget shape:
- Apify free tier ($5/month credit). At WA scale daily refresh: ~$5–15/day,
  so you'll exhaust free quickly; upgrade to Starter ($49/mo) before
  scaling postcode count.
- Hostinger VPS: existing
- mem0 free tier
- OpenRouter pay-as-you-go (load $20 to start)
- Cloudflare Access + Tunnel: free

---

## 1. Push the branch & open the PR

From your laptop:

```bash
cd C:\Dev\Blockwise
git push -u origin feature/hermes-research-engine
gh pr create --base main --title "Hermes research engine" --body "See docs/research-engine/README.md"
```

You don't have to merge yet — the branch deploys via Coolify directly.

## 2. Apply the schema migrations

The new schema lives in `research.*`. Apply to the Supabase project:

```bash
# Option A: supabase CLI (preferred)
supabase link --project-ref <your-ref>
bash scripts/vps/deploy-migrations.sh

# Option B: direct psql
export SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
bash scripts/vps/deploy-migrations.sh
```

This applies:
- `202605280002_research_drop_legacy.sql` — removes the unused legacy tables.
- `202605280003_research_engine.sql` — creates the new schema, RLS,
  refresh policy with Perth metro postcodes seeded.
- `202605280004_research_views.sql` — creates the curated `v_*` views.

## 3. Seed Storage buckets

```bash
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
bash scripts/vps/seed-storage-buckets.sh
```

This creates `research-raw-evidence`, `research-ad-creatives`, `research-screenshots`.

## 4. Bootstrap the VPS

```bash
ssh root@76.13.209.160
curl -fsSL https://raw.githubusercontent.com/stevenshelley58-afk/blockwise/feature/hermes-research-engine/scripts/vps/bootstrap.sh | bash
```

This installs Docker, Coolify, `cloudflared`, ufw, fail2ban. It does NOT
disable password SSH — wait until step 5b finishes first.

## 5. Cloudflare Tunnel + Access

5a. **Create the tunnel** (Cloudflare dashboard → Zero Trust → Networks → Tunnels):
- Name: `blockwise-research`
- Copy the token.

5b. **Run on the VPS**:
```bash
cloudflared service install <TUNNEL_TOKEN>
systemctl enable --now cloudflared
```

5c. **Add public hostnames** to the tunnel:

| Hostname                       | Service                |
| ------------------------------ | ---------------------- |
| `coolify.blockwise.sale`       | http://localhost:8000  |
| `hermes.blockwise.sale`        | http://localhost:8080  |
| `aion.blockwise.sale`          | http://localhost:7000  |
| `uptime.blockwise.sale`        | http://localhost:3001  |

5d. **Add Access policies** (Zero Trust → Access → Applications → Add app):
- Application: each of the above hostnames.
- Policy: Allow → emails → `stevenshelley58@gmail.com` only.
- Session: 24h.

5e. **Now disable SSH password auth** on the VPS:
```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

## 6. Coolify deploy

6a. Open `https://coolify.blockwise.sale`, create admin (one-time).
6b. **Sources → Add → GitHub** and connect this repo.
6c. **New Resource → Docker Compose**:
- Branch: `feature/hermes-research-engine`
- Compose file path: `infra/coolify/docker-compose.research.yml`
- Environment variables (paste into the Coolify env editor — none committed to git):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
APIFY_API_TOKEN=<token>
OPENROUTER_API_KEY=<key>
MEM0_API_KEY=<key>
BROWSERBASE_API_KEY=<key>
BROWSERBASE_PROJECT_ID=<project-id>
HERMES_WEBHOOK_SECRET=<openssl rand -hex 32>
```

6d. Deploy. Coolify pulls the compose, builds the orchestrator + scrapling
images, and launches: `research-orchestrator`, `hermes`, `scrapling`,
`uptime-kuma`, `aionui`.

## 7. Wire Blockwise (Vercel) env

In Vercel:

```
APIFY_API_TOKEN=<same as VPS>
HERMES_BASE_URL=https://hermes.blockwise.sale
HERMES_WEBHOOK_SECRET=<same as VPS>
OPERATOR_EMAILS=stevenshelley58@gmail.com
```

Deploy the Blockwise app from the `feature/hermes-research-engine` branch.

## 8. First smoke test — postcode 6008

8a. Open https://blockwise.sale/operator/research (you'll be challenged by
Cloudflare Access on the admin subdomains, but `blockwise.sale` itself is
public-but-operator-gated by the API routes).

8b. The Coverage table shows all seeded postcodes, all with health
`never_audited`. Click **Run** next to 6008.

8c. Within ~5 minutes the orchestrator picks up the kicked-now policy.
You'll see the run appear in the **Recent fetch runs** panel with status
`running`, then `success` or `partial`.

8d. Verify in Supabase:
```sql
select count(*) from research.observed_ads;
select count(*) from research.ad_creatives;
select * from research.ad_fetch_runs order by started_at desc limit 5;
```

8e. Compare against the Meta Ad Library manually:
- Open https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&q=subiaco%20real%20estate
- Sample 5–10 ads.
- For each, search `research.observed_ads.external_ad_id` for the ad ID.
- Anything we missed → file as `coverage_defects`.

## 9. Turn on the loop

Once 8 passes:
- In Coolify, confirm `research-orchestrator` env has `ORCHESTRATOR_MODE=loop`.
- It will tick every 5 minutes and pick up due pages.

## 10. Add monitoring

Open https://uptime.blockwise.sale, add monitors for:
- `https://api.apify.com/v2/users/me?token=<token>` (returns 200 if quota left)
- `https://hermes.blockwise.sale/health`
- `https://blockwise.sale/api/operator/research/coverage`
- Custom Postgres query: `select max(started_at) from research.ad_fetch_runs where status='success'` — alert if older than 1 hour.

---

## Failure plays

**Apify run keeps returning `no_items`.** The actor wants Page URLs, not search queries. Resolve a real Page first via `blockwise-page-resolver`, then re-run.

**Orchestrator can't find any due pages.** Either no `advertiser_pages` exist yet (run the census skill once), or all are `status != 'resolved'`. The census + page-resolver skills are the upstream.

**Cost spike.** Toggle the kill-switch in the operator console (POST `/api/operator/research/kill-switch` with `paused: true`). All `refresh_policies.active` flip to false; the loop runs but skips every page.

**Hermes is making bad decisions.** Look at `research.agent_decisions` for the offending row, insert a new row with `superseded_by` and the corrected decision, then trigger the affected skill with `force_*=true`.
