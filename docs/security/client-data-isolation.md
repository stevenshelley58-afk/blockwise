# Client Data Isolation

Blockwise is a multi-tenant product. The security model is fail-closed: no data leaves a workspace, agent run, model prompt, storage path, or provider sync unless the runtime context explicitly permits it.

## Invariants

- Every tenant-owned table row has a non-null `workspace_id`.
- Supabase RLS remains enabled for every workspace-scoped table.
- Agents never receive Supabase service-role keys, provider tokens, refresh tokens, or unrestricted database clients.
- Agent runs must use a signed runtime policy and must reject cross-workspace reads unless an approved cross-workspace grant exists.
- Lead PII exports, client-facing sends, campaign publishing, and budget changes require human approval and an audit record.
- Provider tokens live in the private token vault, not in workspace-readable tables.
- Vector stores, caches, and retrieval indexes are separated by workspace or use mandatory fail-closed `workspace_id` filters.
- Sensitive model runs use operator-approved model profiles and runtime data-class policies before any prompt leaves the server.

## Implemented Controls

- `src/lib/ai-workforce/runtime-policy.ts` enforces allowed actions, data classes, destinations, outbound domains, row limits, and workspace scope.
- `src/lib/ai/model-registry.ts` resolves approved model profiles, including OpenRouter selections saved by operators.
- `supabase/migrations/202605270001_security_hardening.sql` creates `private.provider_token_vault`, removes token columns from `public.provider_connections`, denies client-side writes to server-owned security tables, adds agent policy columns, and records cross-workspace grants.
- `scripts/verify-env.mjs` warns when recommended production security variables are missing.
- Tests cover agent isolation, sensitive-data detection, model fallback filtering, and migration guardrails.

## Cloudflare Production Checklist

- Put the production domain behind Cloudflare proxied DNS.
- Enable WAF managed rules, rate limiting, bot controls, and Turnstile on abuse-prone forms.
- Protect `/operator`, preview deployments, internal tools, and private APIs with Cloudflare Zero Trust Access, SSO, MFA, and device posture.
- Use Cloudflare Access service tokens for machine-to-machine endpoints that should not be internet-public.
- Put public APIs behind API Shield with schema validation, JWT validation, sensitive endpoint discovery, and mTLS where supported.
- Route AI provider calls through Cloudflare AI Gateway with authentication, DLP policies, per-workspace metadata, and short or disabled payload logging for sensitive requests.
- Route agent-runner egress through Cloudflare Gateway or an equivalent controlled egress proxy. Allow only approved domains.
- Send Cloudflare WAF, Access, Gateway, and AI Gateway logs to the security audit drain or SIEM.
- Use Cloudflare CASB/DLP for connected SaaS systems that may hold client files or exported leads.

## Operational Checks

- Run tenant-isolation tests before every release.
- Review operator accounts and workspace memberships monthly.
- Rotate provider secrets and OAuth tokens on a schedule and after staff or client offboarding.
- Audit cross-workspace grants weekly and expire them aggressively.
- Treat prompt-injection findings as security bugs when untrusted client or public web content can influence agent tool calls.
