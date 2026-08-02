# Rollback Runbook

Use this when a production deployment must be reversed, provider writes must
stop, or queued work must be paused.

## Current Runtime Posture

- Vercel serves the app and runs customer-critical Ad Studio generation inline.
- Supabase owns Auth, Postgres, RLS, Storage, and the durable `job_queue`.
- The VPS `job_queue` worker owns Meta publishing, mutations, lead delivery,
  reporting/provider maintenance, and Ad Studio crash recovery.
- Vercel Cron routes enqueue scheduled work; they do not execute provider writes.
- Meta campaigns, ad sets, creatives, lead forms, and ads are created paused.

Manual Ad Studio export is not a provider write. If export generation or
download breaks, roll back Vercel; there are no Meta objects to clean up from
export alone.

## 1. Vercel Instant Rollback

1. Open **Vercel Dashboard → blockwise → Deployments**.
2. Find the last known-good deployment by timestamp and git SHA.
3. Choose **Promote to Production**.
4. Verify the Production URL and `/api/health`.

Do not use localhost as rollback acceptance evidence.

## 2. Kill Provider Writes

Set this in the VPS worker deployment and Vercel Production:

```bash
BLOCKWISE_ENABLE_PROVIDER_WRITES=false
```

Restart the VPS worker after changing its environment and redeploy/promote the
Vercel app if its environment changed. The flag is checked before Meta publish,
Meta mutation, and non-manual lead delivery.

Re-enable only after the incident is understood and approval-gated publish
checks pass.

## 3. Pause Scheduled Or Queued Work

- Disable the affected Vercel Cron entry in `vercel.json` and deploy, or pause
  Cron from the Vercel dashboard.
- Stop the VPS worker to halt all queue consumption.
- To stop only provider writes while retaining read/reporting jobs, leave the
  worker running and use `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`.
- Inspect `public.job_queue` for pending, processing, or failed jobs. Preserve
  rows during incidents for audit and recovery.

After changing `worker/**` or a module imported by the worker, deploy committed
source with `docs/runbooks/vps-worker-deploy.md`.

## 4. Pause Runaway Meta Objects

1. Open [Meta Ads Manager](https://adsmanager.facebook.com/) and select the
   affected ad account.
2. Filter campaigns by the incident window.
3. Pause suspect campaigns. Delete only when they must never resume.
4. Repeat for orphaned ad sets or ads.

Provider writes off prevents more Blockwise-created objects, but does not pause
objects already created on Meta.

## Quick Reference

| Symptom | First action |
| --- | --- |
| Wrong app code is live | Vercel instant rollback |
| Provider mutations are unexpected | Set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` and restart the VPS worker |
| Lead delivery targets the wrong destination | Provider writes off, then inspect `job_queue` |
| Scheduled tasks loop | Pause the relevant Vercel Cron |
| Queue work is unsafe | Stop the VPS worker |
| Meta spend is unexpected | Pause objects in Ads Manager and disable provider writes |

After any rollback, record the incident window, affected workspaces/jobs,
actions taken, and the prevention change.
