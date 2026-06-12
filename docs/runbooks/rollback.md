# Rollback Runbook

Use this document when a production deployment needs to be reversed, provider
writes need to be stopped, or Trigger.dev work needs to be paused.

## Current Export And Publish Posture

Manual Ad Studio export is not a provider write. If export package generation or
download breaks, rollback the Vercel app deployment; there are no Meta objects
to clean up from export alone.

Live publish is separate from export:

- Customer action prepares a Meta publish plan and can request approval.
- Provider writes must be enabled with `BLOCKWISE_ENABLE_PROVIDER_WRITES=true`.
- The Meta publish worker only executes approved plans.
- Created Meta campaign, ad set, creative, lead form, and ad objects are created
  paused.
- Activation and budget mutations require separate approved mutation requests.
- Meta lead retrieval is a manual sync action.
- Non-manual lead delivery requires approval and the provider-write flag.
- Manual lead destinations stay in manual review and do not call external lead
  destinations.

Rollback decisions should start from that distinction: broken export is an app
rollback; runaway Meta mutation or lead delivery starts with provider writes
off and Trigger schedules paused.

## 1. Vercel Instant Rollback

Fastest path when the wrong web app code is live. No local deployment is
required.

1. Go to **Vercel Dashboard -> blockwise -> Deployments**.
2. Find the last known-good deployment by timestamp and git SHA.
3. Choose **Promote to Production** for that deployment.
4. Confirm. Traffic shifts without a rebuild.

Verify from the Production URL and Vercel dashboard. Do not use localhost as
rollback acceptance evidence.

## 2. Kill Provider Writes

Use when a good or bad deploy is mutating Meta objects or delivering leads and
you need a safe mode before the full rollback decision.

Set this in both Vercel Production and the matching Trigger.dev environment:

```bash
BLOCKWISE_ENABLE_PROVIDER_WRITES=false
```

Then redeploy the web app through Vercel and redeploy Trigger.dev tasks so both
request routes and workers receive the same value.

```bash
npm run trigger:deploy
```

The flag is checked in:

- Vercel routes that queue or prepare provider work.
- Trigger workers for Meta publish, Meta mutation, and lead delivery.
- Lead delivery workers before non-manual CRM/webhook calls.

Re-enable only after the incident is understood and approval-gated publish
checks pass:

```bash
BLOCKWISE_ENABLE_PROVIDER_WRITES=true
npm run trigger:deploy
```

## 3. Pause Trigger.dev Schedules

Use when scheduled tasks are causing harm or obscuring rollback verification.

1. Open **Trigger.dev Dashboard -> blockwise project -> Schedules**.
2. Pause or disable active schedules:
   - `sync.meta.leads.scheduled`
   - `check.meta.token-health.scheduled`
   - `sync-provider-reports`
   - `paid-service-watchdog`
3. In-flight runs may finish; no new scheduled runs should start.

On-demand tasks are triggered by app routes or operator actions. Stop those by
setting `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`, rolling back Vercel, or
deploying a code fix.

## 4. Trigger.dev Deployments And Env

Trigger.dev tasks deploy automatically after the GitHub `main` branch checks
pass. The workflow job is `trigger-deploy`; it depends on `contracts` and runs
`npm run trigger:deploy` only on pushes to `main`.

The workflow requires these GitHub secrets:

- `TRIGGER_ACCESS_TOKEN`
- `TRIGGER_PROJECT_ID`

Missing `TRIGGER_PROJECT_ID` is a hard failure in the GitHub deploy workflow.
`trigger.config.ts` also pins Blockwise's non-secret Trigger project ref because
Trigger.dev imports the config inside the managed deployment build without
exposing the workflow env as process env.

Keep these variables set in the Trigger.dev project environment that matches
Production:

- `TRIGGER_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_APP_ID`
- `META_APP_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `BLOCKWISE_ENABLE_PROVIDER_WRITES`
- `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`

After changing any of those values, redeploy tasks with
`npm run trigger:deploy` or wait for the next successful `main` push.

## 5. Pause Or Delete Runaway Meta Campaign Objects

Use when Meta campaign objects were created and need to be stopped immediately.

Via Ads Manager:

1. Open [Meta Ads Manager](https://adsmanager.facebook.com/) and select the
   affected ad account.
2. Filter campaigns by the bad deploy window.
3. Select suspect campaigns and pause them. Delete only when they must not
   resume.
4. Repeat for orphaned ad sets or ads under those campaigns.

Provider writes off prevents more Blockwise-created objects, but it does not
pause objects already created in Meta.

Verify in Ads Manager that spend stopped accruing.

## Quick Reference

| Symptom | First action |
| --- | --- |
| Manual export package is broken | Vercel instant rollback |
| Wrong app code is live | Vercel instant rollback |
| Provider mutations are running unexpectedly | Set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` in Vercel and Trigger.dev, then redeploy both |
| Lead delivery is calling a wrong CRM/webhook | Set provider writes off and pause relevant Trigger activity |
| Scheduled tasks loop or create noise | Pause Trigger.dev schedules |
| Trigger tasks failed to deploy | Check GitHub `trigger-deploy` job, GitHub secrets, and Trigger env |
| Meta campaigns spend unexpectedly | Pause in Ads Manager and set provider writes off |

After any rollback, open a postmortem in `docs/runbooks/` and note what broke,
when it was detected, rollback steps taken, and follow-up prevention.
