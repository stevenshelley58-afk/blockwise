# Agent Safety

Blockwise agents are allowed to draft, classify, summarize, recommend, and queue reviewable actions. They are not allowed to publish campaigns, change budgets, send client-facing messages, or export lead PII without a human approval record.

## Runtime Boundary

- Blockwise-native workers are the default runtime.
- Hermes-style agents, OpenAI Agents, OpenRouter-routed agents, and other runtimes are optional adapters.
- External runtimes receive scoped task payloads and call Blockwise APIs; they do not receive provider tokens, service-role keys, or unnecessary lead PII.
- Every run must be built from an `AgentRuntimePolicy` containing `workspaceId`, `agentRunId`, `actorProfileId`, `agentKey`, allowed actions, allowed data classes, allowed destinations, allowed outbound domains, row limits, and explicit approval ids.
- `canCrossWorkspace` defaults to `false` and must stay false unless a specific cross-workspace approval record exists.
- Agent tools must reject work when the requested `workspaceId` does not match the runtime policy.

## Reviewable Artifacts

Agent outputs are stored in `agent_artifacts`, connected to `agent_runs`, and surfaced in the Operator Console with confidence, cost, status, errors, and required human action.

Artifacts must be tagged with a data class. Artifacts containing lead PII, provider tokens, or secrets are blocked from model prompts, external exports, and public storage paths unless a human approval record permits the exact action.

## Data Classes

- `public_competitor_data`: public ads, screenshots, landing-page observations, and other public evidence.
- `performance_metrics`: spend, leads, CPL, campaign health, and reporting summaries.
- `campaign_draft`: internal campaign concepts, copy, structures, and review notes.
- `creative_asset`: generated creative files, briefs, image prompts, and thumbnails.
- `compliance_risk`: policy findings, unsupported claims, housing targeting risk, urgency risk, and review evidence.
- `lead_pii`: names, emails, phones, raw lead payloads, and dedupe identities.
- `provider_token`: OAuth tokens, refresh tokens, app secrets, and service credentials.

No agent should receive `lead_pii` or `provider_token` by default.

## Model And Egress Rules

- Use `resolveModelProfileForData` for model selection whenever data classes are known.
- Operator-approved OpenRouter profiles can be used for model prompts, including sensitive client data, after the runtime policy permits the data classes and outbound domain.
- Production AI calls should go through Cloudflare AI Gateway with authenticated access, DLP checks, prompt/response logging disabled or tightly retained for sensitive runs, and per-workspace metadata.
- Outbound agent traffic must be allowlisted. Default approved model domains are `api.openai.com`, `gateway.ai.cloudflare.com`, and `openrouter.ai`; provider APIs should be added only to server-owned sync/publish workers.

## Detection

Run tests that seed cross-client canary records and assert those values never appear in another workspace prompt, response, artifact, export, or audit destination.
