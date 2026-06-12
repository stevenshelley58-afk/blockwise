# Vercel Deployment

Blockwise hosts the Next.js website and request/response route handlers on Vercel. Supabase owns database/auth/storage, and Trigger.dev owns durable scheduled and retrying work.

## Project Setup

1. Create a Vercel project connected to this repository.
2. Set Framework Preset to `Next.js`.
3. Keep the region close to the first market: `syd1`.
4. Add the variables from `.env.example` to Local, Preview, and Production environments.
5. Run `npm run verify-env` in CI before production deployment.

## Environment Groups

- Public client values: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, and `NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA`.
- Server-only values: Supabase service role, token encryption key, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, Cloudflare AI Gateway values, Trigger.dev keys, Meta/Google app secrets, Resend key, `OPERATOR_EMAILS`, `BLOCKWISE_DEV_PASSWORD`, `META_MONITOR_BUDGET_AUD`, and `CRON_SECRET`.
- Feature flags: keep `GOOGLE_ADS_ENABLED=false` unless the Google Ads integration is being deliberately enabled.
- Provider-write control: set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` for Preview and initial Production smoke testing, then switch to `true` only after approval-gated publish checks pass.
- Never expose provider access tokens, service-role keys, or lead PII to client components or agent workers.
- Recommended production security values: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `CLOUDFLARE_AI_GATEWAY_URL`, and `CLOUDFLARE_AI_GATEWAY_TOKEN`.
- Sensitive AI requests should use Cloudflare AI Gateway or another approved gateway path before leaving the server runtime.
- Set `TURNSTILE_SECRET_KEY` in the Supabase Auth dashboard; the Next.js app does not read it.

## Deployment Checks

Run deployment checks through Vercel build and preview workflows. Do not run local deployments, and do not treat localhost smoke tests as deployment-readiness evidence.

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run verify-env`
- Visit `/api/health` on the preview URL and confirm `status` is `ready` once secrets are configured.
- Use `Authorization: Bearer $CRON_SECRET` when checking detailed `/api/health` or `/api/health/research` output.
- Confirm `/api/health` has no `readiness.security.missingRecommended` entries before handling live client data.

## Durable Jobs

Vercel functions should handle only request/response work. Provider syncs, webhook retries, scheduled research, reporting summaries, and agent workflows run in Trigger.dev jobs under `trigger/`.
