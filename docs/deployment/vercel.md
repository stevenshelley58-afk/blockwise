# Vercel Deployment

Blockwise hosts the Next.js website and request/response route handlers on Vercel. Supabase owns database/auth/storage, and Trigger.dev owns durable scheduled and retrying work.

## Project Setup

1. Create a Vercel project connected to this repository.
2. Set Framework Preset to `Next.js`.
3. Keep the region close to the first market: `syd1`.
4. Add the variables from `.env.example` to Local, Preview, and Production environments.
5. Run `npm run verify-env` in CI before production deployment.

## Environment Groups

- Public client values: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.
- Server-only values: Supabase service role, token encryption key, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, Trigger.dev keys, Meta/Google app secrets, Resend key, Sentry auth token.
- Provider-write control: set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` for Preview and initial Production smoke testing, then switch to `true` only after approval-gated publish checks pass.
- Never expose provider access tokens, service-role keys, or lead PII to client components or agent workers.
- Recommended production security values: `CLOUDFLARE_AI_GATEWAY_URL`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `AGENT_ALLOWED_OUTBOUND_DOMAINS`, and `SECURITY_AUDIT_LOG_DRAIN_URL`.
- Sensitive AI requests should use Cloudflare AI Gateway or another approved gateway path before leaving the server runtime.

## Deployment Checks

Run deployment checks through Vercel build and preview workflows. Do not run local deployments, and do not treat localhost smoke tests as deployment-readiness evidence.

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run verify-env`
- Visit `/api/health` on the preview URL and confirm `status` is `ready` once secrets are configured.
- Confirm `/api/health` has no `readiness.security.missingRecommended` entries before handling live client data.

## Durable Jobs

Vercel functions should handle only request/response work. Provider syncs, webhook retries, scheduled research, reporting summaries, and agent workflows run in Trigger.dev jobs under `trigger/`.
