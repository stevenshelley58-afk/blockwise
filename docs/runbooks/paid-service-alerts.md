# Paid-Service Alerts Runbook (historical managed runtime)

> HISTORICAL ONLY: This runbook describes Vercel Cron, Vercel Spend
> Management, and managed Supabase alerting. It is not a current product
> deployment runbook and must not be used as evidence for the self-hosted VPS
> cutover. Keep it for historical reference until an OSS scheduler/alerting
> procedure replaces it.

Blockwise warns by **email + WhatsApp** before any paid service hits its limit,
and immediately when a provider outage would break ad creation.

Two mechanisms:

1. **Vercel Cron watchdog** - `/api/alerts/paid-service-watchdog`, every 2
   hours. Polls usage and health, alerts at **80% (warn)** and **95%
   (critical)** of each budget/cap, and treats unreachable providers or rejected
   API keys as critical because a customer pressing "generate" is already
   failing. Alerts fire on level *changes* only, plus a recovery note, so a
   service sitting at 85% does not spam every run. Last alerted levels are
   stored as a `research.runtime_settings` row
   (`paid_service_watchdog_state`) - no schema change.
2. **Vercel Spend Management webhook** - `/api/alerts/vercel-spend` re-sends
   Vercel's 50/75/100% spend notifications through the same channels.

## What the watchdog covers

| Service | Signal | Limit compared against |
|---|---|---|
| OpenRouter (Hermes + Ad Studio) | `GET /api/v1/credits`: usage vs purchased credits, remaining balance, key validity | `OPENROUTER_MIN_CREDITS_USD` floor (default $5) + 80/95% of purchased credits |
| OpenAI spend | `GET /v1/organization/costs` month-to-date | `OPENAI_MONTHLY_BUDGET_USD` (default $50) |
| OpenAI API health | `GET /v1/models` with the runtime key | 401/403/5xx -> critical, 429 -> warn |
| Hermes paid capture | Supabase `research.v_health.apify_mtd_spend_usd` + circuit state written by Hermes | `apify_monthly_cap_usd` runtime setting ($25); circuit open -> warn |
| VPS / Hermes host | `VPS_HEALTH_URLS` HTTP checks | non-2xx/timeout -> warn or critical |
| Vercel | Spend Management webhook (not polled) | Spend amount set in Vercel dashboard |

Checks with missing env vars are skipped; check failures alert rather than
fail silently.

## Setup

### 1. Email

Set in **Vercel** environment:

- `RESEND_API_KEY` - existing key.
- `ALERT_EMAIL_TO` - where warnings go, falling back to `DEMO_NOTIFY_TO`.
- `ALERT_EMAIL_FROM` - verified sender, falling back to `DEMO_NOTIFY_FROM`.
- `CRON_SECRET` - required for the Vercel Cron watchdog route and for detailed health responses.

### 2. WhatsApp via Twilio

1. Create a Twilio account, then open Console > Messaging > Try WhatsApp to use
   the sandbox, or register a WhatsApp sender on your own number.
2. Sandbox: from your phone, send the join code shown in the console to the
   sandbox number (+14155238886). Sandbox sessions expire after 72 hours of
   inactivity; re-join, or register a proper sender for reliability.
3. Set env vars in Vercel: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM`, and `ALERT_WHATSAPP_TO`.

Docs: https://www.twilio.com/docs/whatsapp/quickstart

### 3. OpenAI admin key

`OPENAI_API_KEY` cannot read org costs. Create an **Admin key** at
platform.openai.com > Settings > Organization > Admin keys, set it as
`OPENAI_ADMIN_KEY`, and set `OPENAI_MONTHLY_BUDGET_USD` to the real monthly
budget. Also set a hard **budget limit** in the OpenAI dashboard as the
backstop.

### 4. VPS / Hermes health

Set `VPS_HEALTH_URLS` in Vercel production to one or more comma-separated
health endpoints. Use `Label|URL` when you want readable alert names, for
example:

```text
VPS_HEALTH_URLS=Hermes VPS|https://<vps-health-domain>/health,Steel CDP|https://<browser-health-domain>/health
```

Prefer off-box/public health URLs so the alert still fires if the VPS itself is
down. The existing `/api/health/research` endpoint on Vercel remains the
Supabase-backed research health surface for external uptime monitors when Ad
Radar is enabled; while the launch feature flag is off it returns HTTP 200 with
`status: "disabled"` without querying the research service, so monitors should
treat that state as intentionally paused rather than unhealthy.

### 4a. Hermes-only Apify execution

`APIFY_TOKEN` / `APIFY_API_TOKEN` belongs only in the Hermes/VPS runtime
environment. Do not set it in Vercel. Vercel's watchdog only reads the
Supabase health and ledger fields that Hermes writes; it must not dispatch
Apify runs, check Apify account limits, or run Apify actor canaries.

### 5. Vercel Spend Management

Vercel dashboard > Team Settings > Billing > Spend Management: set a spend
amount, enable email/SMS notifications, and add the webhook URL
`https://blockwise.sale/api/alerts/vercel-spend`. Save the webhook secret as
`VERCEL_SPEND_WEBHOOK_SECRET` in Vercel env. Decide whether "pause production
deployments at 100%" should stay on.

Docs: https://vercel.com/docs/spend-management

### 6. Deploy the watchdog

```powershell
vercel deploy --prod
```

Then confirm `vercel crons ls` shows `/api/alerts/paid-service-watchdog` with
schedule `0 */2 * * *`.

### 7. Native alerts to switch on

- **Supabase** (main + Hermes projects): no public usage API - keep the spend
  cap on and usage notification emails enabled. Going over quota on the
  free/spend-capped plan pauses the project, which would take ad creation down.
- **Resend**: dashboard sending-quota notifications.
- **Sentry**: use built-in quota/billing alerts; enable them in org settings.
- **Google Places API**: Google Cloud Console > Billing > Budgets & alerts -
  create a budget with 80%/95% email thresholds.
- **Meta / Google Ads APIs**: rate-limited rather than billed; failures surface
  through provider-sync job errors, not spend.

## Responding to an alert

- **OpenRouter low/exhausted** - top up credits at openrouter.ai/credits.
  Hermes also self-limits via `HERMES_DAILY_SPEND_LIMIT_USD`.
- **OpenAI 80/95%** - review usage at platform.openai.com/usage; raise the
  budget or investigate runaway generation.
- **OpenAI/OpenRouter key rejected or 5xx** - ad creation is failing now; check
  provider status pages and key validity first.
- **Hermes paid capture near cap / circuit open** - see
  `research.runtime_settings` (`apify_*` keys), the Hermes runtime logs, and
  the Apify console; Hermes already blocks paid dispatch when the circuit is
  open.
- **Vercel 100%** - check whether production deployments were paused.

## Testing the pipeline

Call `/api/alerts/paid-service-watchdog` with `Authorization: Bearer
$CRON_SECRET`. To force an alert end-to-end, temporarily set
`OPENROUTER_MIN_CREDITS_USD` above your current balance and run it again; you
should get both the email and the WhatsApp message, and a recovery note on the
next run after reverting.
