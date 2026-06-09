# Rollback Runbook

Use this document when a production deployment needs to be reversed or a runaway process needs to be stopped.

## 1. Vercel Instant Rollback

Fastest path — no redeploy required.

1. Go to **Vercel Dashboard → blockwise → Deployments**.
2. Find the last known-good deployment (check timestamp / git SHA).
3. Click **⋯ → Promote to Production**.
4. Confirm. Traffic shifts within ~30 s; no build required.

Verify: open `https://blockwise.sale` and confirm the expected commit SHA in the `x-vercel-id` response header or Vercel dashboard.

## 2. Kill Provider Writes (Safe Mode)

Use when a bad deploy is mutating Meta / Google Ads objects but a full rollback isn't yet confirmed.

```bash
# In Vercel Dashboard → Settings → Environment Variables
# Set for Production:
BLOCKWISE_ENABLE_PROVIDER_WRITES=false

# Then redeploy (or use "Redeploy" on the current deployment):
vercel redeploy --prod
```

All `executeMetaPublishPlanTask`, `executeMetaMutationTask`, and provider-sync writes will short-circuit without calling the Meta/Google APIs.

Revert by setting `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` and redeploying.

## 3. Pause Trigger.dev Schedules

Use when scheduled tasks (lead sync, token health, provider reports, watchdog) are causing harm.

1. Open **Trigger.dev Dashboard → blockwise project → Schedules**.
2. For each active schedule, click **Pause** (or **Disable**):
   - `sync.meta.leads.scheduled` (every 15 min)
   - `check.meta.token-health.scheduled` (every 6 h)
   - `sync-provider-reports` (every 6 h)
   - `paid-service-watchdog` (every 2 h)
3. In-flight runs finish; no new runs are triggered.

To re-enable, click **Resume** on each schedule.

For on-demand tasks (`publish.meta.execute`, `publish.meta.mutate`, `sync.meta.leads`, `deliver.lead`, `sync-provider-workspace`): these are triggered by API routes — stopping them requires setting `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` (step 2) or deploying a code change.

## 4. Pause / Delete Runaway Meta Campaign Objects

Use when Meta campaign objects were created by a bad deploy and need to be stopped immediately.

**Via Ads Manager (manual):**
1. Open [Meta Ads Manager](https://adsmanager.facebook.com/) → select the affected Ad Account.
2. Filter campaigns by date (creation time matches the bad deploy window).
3. Select all suspect campaigns → **Pause** (or **Delete** if they must not resume).
4. Repeat for any orphaned Ad Sets / Ads under those campaigns.

**Via `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` (prevents further creation):**
See step 2 — this stops Blockwise from creating more objects but does not pause already-live Meta campaigns.

**Verify:** In Ads Manager, confirm spend stopped accruing on the affected campaigns.

---

## Quick-Reference Decision Tree

| Symptom | First action |
|---|---|
| Wrong code is live | Vercel instant rollback (§1) |
| Good code but provider mutations running wild | Set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` + redeploy (§2) |
| Scheduled tasks looping / causing harm | Pause Trigger.dev schedules (§3) |
| Meta campaigns spending unexpectedly | Pause in Ads Manager (§4) + provider writes off (§2) |

After any rollback, open a post-mortem in `docs/runbooks/` and note: what broke, when detected, rollback steps taken, and follow-up prevention.
