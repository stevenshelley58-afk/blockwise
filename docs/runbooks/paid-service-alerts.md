# Paid-Service Alerts Runbook

Blockwise warns by **email + WhatsApp** before any paid service hits its limit,
and immediately when a provider outage would break ad creation.

Three mechanisms:

1. **Watchdog** — Trigger.dev scheduled task `paid-service-watchdog`
   (`trigger/paid-service-watchdog.ts`), every 2 hours. Polls usage and health,
   alerts at **80% (warn)** and **95% (critical)** of each budget/cap, and
   treats unreachable providers or rejected API keys as critical (because a
   customer pressing "generate" is already failing). Alerts fire on level
   *changes* only (plus a recovery note), so a service sitting at 85% does not
   spam every run. Last alerted levels are stored as a
   `research.runtime_settings` row (`paid_service_watchdog_state`) — no schema
   change.
2. **Vercel Spend Management webhook** — `/api/alerts/vercel-spend` re-sends
   Vercel's 50/75/100% spend notifications through the same channels.

3. **Vercel Cron fallback** - `/api/alerts/paid-service-watchdog` runs the same
   watchdog every 2 hours from Vercel when `CRON_SECRET` is configured.

## What the watchdog covers

| Service | Signal | Limit compared against |
|---|---|---|
| OpenRouter (Hermes + Ad Studio) | `GET /api/v1/credits`: usage vs purchased credits, remaining balance, key validity | `OPENROUTER_MIN_CREDITS_USD` floor (default $5) + 80/95% of purchased credits |
| OpenAI spend | `GET /v1/organization/costs` month-to-date | `OPENAI_MONTHLY_BUDGET_USD` (default $50) |
| OpenAI API health | `GET /v1/models` with the runtime key | 401/403/5xx → critical, 429 → warn |
| Apify | `research.v_health.apify_mtd_spend_usd` + circuit state | `apify_monthly_cap_usd` runtime setting ($25); circuit open → warn |
| VPS / Hermes host | `VPS_HEALTH_URLS` HTTP checks | non-2xx/timeout -> warn or critical |
| Vercel | Spend Management webhook (not polled) | Spend amount set in Vercel dashboard |

Checks with missing env vars are skipped; check failures alert rather than
fail silently.

## Setup

### 1. Email (already mostly wired)

Set in **Vercel and Trigger.dev** environment:

- `RESEND_API_KEY` — existing key.
- `ALERT_EMAIL_TO` — where warnings go (falls back to `DEMO_NOTIFY_TO`).
- `ALERT_EMAIL_FROM` — verified sender (falls back to `DEMO_NOTIFY_FROM`).

### 2. WhatsApp via Twilio

1. Create a Twilio account → Console → Messaging → **Try WhatsApp** to use the
   sandbox (instant), or register a WhatsApp sender on your own number
   (production-grade, takes approval).
2. Sandbox: from your phone, send the join code shown in the console to the
   sandbox number (+14155238886). Note: sandbox sessions expire after 72 hours
   of inactivity — re-join, or register a proper sender for reliability.
3. Set env vars (Vercel + Trigger.dev): `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (e.g. `+14155238886`),
   `ALERT_WHATSAPP_TO` (your number, E.164, e.g. `+614xxxxxxxx`).

Docs: https://www.twilio.com/docs/whatsapp/quickstart

### 3. OpenAI admin key

`OPENAI_API_KEY` cannot read org costs. Create an **Admin key** at
platform.openai.com → Settings → Organization → Admin keys, set it as
`OPENAI_ADMIN_KEY`, and set `OPENAI_MONTHLY_BUDGET_USD` to your real monthly
budget. Also set a hard **budget limit** in the OpenAI dashboard (Billing →
Limits) as the backstop.

### 4. VPS / Hermes health

Set `VPS_HEALTH_URLS` in Trigger.dev to one or more comma-separated health
endpoints. Use `Label|URL` when you want readable alert names, for example:

```
VPS_HEALTH_URLS=Hermes VPS|https://<vps-health-domain>/health,Steel CDP|https://<browser-health-domain>/health
```

Prefer off-box/public health URLs so the alert still fires if the VPS itself is
down. The existing `/api/health/research` endpoint on Vercel remains the
Supabase-backed research health surface for external uptime monitors.

### 5. Vercel Spend Management

Vercel dashboard → Team Settings → Billing → **Spend Management**: set a spend
amount, enable email/SMS notifications, and add the webhook URL
`https://blockwise.sale/api/alerts/vercel-spend`. Save the webhook secret as
`VERCEL_SPEND_WEBHOOK_SECRET` in Vercel env. Decide whether "pause production
deployments at 100%" should stay on. Docs: https://vercel.com/docs/spend-management

### 6. Deploy the watchdog

```
npx trigger.dev deploy
```

Then confirm `paid-service-watchdog` appears in the Trigger.dev dashboard and
copy all the env vars above into the Trigger.dev project environment, including
`VPS_HEALTH_URLS` if VPS/Hermes host health should be polled (the task runs
there, not on Vercel).

### 7. Native alerts to switch on (no code, do once)

- **Supabase** (main + Hermes projects): no public usage API — keep the spend
  cap on (Project → Billing) and usage notification emails enabled. Going over
  quota on the free/spend-capped plan pauses the project, which *would* take
  ad creation down.
- **Trigger.dev**: dashboard → Billing — enable usage emails for run limits.
- **Resend**: dashboard — sending-quota notifications.
- **Sentry / PostHog**: both have built-in quota/billing alerts — enable in org
  settings.
- **Google Places API**: Google Cloud Console → Billing → Budgets & alerts —
  create a budget with 80%/95% email thresholds.
- **Meta / Google Ads APIs**: rate-limited rather than billed; failures surface
  through provider-sync job errors, not spend.

## Responding to an alert

- **OpenRouter low/exhausted** — top up credits at openrouter.ai/credits.
  Hermes also self-limits via `HERMES_DAILY_SPEND_LIMIT_USD`.
- **OpenAI 80/95%** — review usage at platform.openai.com/usage; raise the
  budget or investigate runaway generation.
- **OpenAI/OpenRouter key rejected or 5xx** — ad creation is failing *now*;
  check provider status pages and key validity first.
- **Apify near cap / circuit open** — see `research.runtime_settings`
  (`apify_*` keys) and the Apify console; the runtime already blocks paid
  dispatch when the circuit is open.
- **Vercel 100%** — check whether production deployments were paused.

## Testing the pipeline

Trigger a manual run from the Trigger.dev dashboard (Test → `paid-service-watchdog`).
To force an alert end-to-end, temporarily set `OPENROUTER_MIN_CREDITS_USD`
above your current balance and run it again; you should get both the email and
the WhatsApp message, and a recovery note on the next run after reverting.
