# Production Readiness Runbook

## Before First Production Release

- Apply Supabase migrations in `supabase/migrations`.
- Confirm RLS is enabled on all workspace-scoped tables.
- Confirm `private.provider_token_vault` exists and provider token columns are not present on `public.provider_connections`.
- Create the private `workspace-artifacts` storage bucket.
- Configure Vercel environment variables for Production and Preview, including `OPENROUTER_API_KEY` before enabling OpenRouter model tests or routed runs.
- Configure the recommended production security variables: `CLOUDFLARE_AI_GATEWAY_URL`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `AGENT_ALLOWED_OUTBOUND_DOMAINS`, and `SECURITY_AUDIT_LOG_DRAIN_URL`.
- Configure Trigger.dev project and deploy jobs with `npm run trigger:deploy`.
- Configure Sentry and PostHog projects.
- Create a demo workspace and one operator profile.
- Put operator/admin surfaces behind Cloudflare Zero Trust Access with SSO and MFA.
- Enable Cloudflare WAF managed rules, rate limiting, bot controls, and API Shield for public endpoints.
- Configure Cloudflare AI Gateway DLP and logging retention before allowing live client data into model calls.
- Configure a controlled egress path for agent runners and allowlist only approved provider/model domains.

## Release Gates

- Operator routes reject non-operator clients once live auth guards are connected.
- Provider publishing remains blocked until approval requests are approved.
- Agents cannot access raw provider tokens or export lead PII.
- Agents cannot run without an `AgentRuntimePolicy`.
- Agents cannot access another workspace unless a specific cross-workspace approval/grant exists.
- Sensitive model runs use only operator-approved model profiles and runtime data-class policies.
- Every AI call writes `ai_runs` and `ai_usage_ledger`.
- Every client-facing publish, budget change, send, and PII export writes an audit log.
- Client-side writes to server-owned security tables are denied by RLS.

## Incident Checks

- `/api/health` reports missing env vars.
- `/api/health` reports recommended security configuration gaps under `readiness.security`.
- Operator Console shows sync failures, blocked AI outputs, and approval queues.
- Trigger.dev dashboard shows retries and failed job payloads.
- Sentry captures server route and rendering errors.
- Cloudflare log drains show WAF, Access, Gateway, and AI Gateway events.
- Cross-client canary records do not appear in another workspace prompt, response, artifact, export, or log.
