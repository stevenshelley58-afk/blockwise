# Blockwise Hermes Runtime

This directory holds Blockwise-specific Hermes skills and local tool modules
that are deployed to the Hermes Agent instance on the Hostinger VPS. They are
not loaded by the Next.js app at runtime.

## Skills

| Skill | What it does |
| ----- | ------------ |
| `blockwise-agent-census` | Owns the real-estate roster for a postcode and is the only skill that can mark an agency real-estate verified |
| `blockwise-page-resolver` | Resolves a verified agent or agency to its real Meta advertiser page |
| `blockwise-ad-collector` | Collects ads only for resolved, real-estate-gated advertiser pages |
| `blockwise-ad-classifier` | Tags captured creatives with type, hook, style, audience, and confidence |
| `blockwise-coverage-auditor` | Audits postcode coverage and opens defects for gaps instead of ingesting sampled ads |
| `blockwise-defect-investigator` | Replays a coverage defect and queues the owning skill for repair |
| `blockwise-operator-chat` | NL queries from Blockwise `/operator` over `research.v_*` views |

## Tools

| Tool | Purpose |
| ---- | ------- |
| `tools/research-runtime` | Deterministic JSON-serialisable queue, worker, supervisor, and env-driven OpenRouter client |
| `tools/meta-library-capture` | Disabled-by-default, resolved-page-only Meta Ad Library capture scaffold for future Hermes-owned adapters |

## Runtime Rules

1. Census first. `blockwise-agent-census` is the roster owner and the only
   path that can set or request `is_real_estate = true`.
2. No location-based Meta Ad Library discovery in v1. Postcode or suburb
   browsing may only create coverage defects; it must not create agencies,
   advertiser pages, or displayable ads.
3. Collection is page-first. `blockwise-ad-collector` requires a resolved
   `advertiser_page_id`, a Meta page id, a resolver decision, and a real-estate
   gate from the census.
4. No arbitrary SQL. Skills write through the signed ingestion API or approved
   Hermes tool boundary. Reads must stay scoped to the skill input.
5. Every write is a decision. Database mutations need a matching
   `research.agent_decisions` row with evidence, confidence, rationale, and
   model/cost trace.
6. Source evidence is mandatory. Every claim cites a URL and a
   `source_documents.id`.
7. Provider failure is not absence. Login walls, blocks, timeouts, bad payloads,
   and failed provider responses mark the run failed or open a defect.
8. OpenRouter model names are environment-driven only. Set
   `HERMES_DEFAULT_MODEL`, `HERMES_ESCALATION_MODEL`, or
   `HERMES_OPENROUTER_MODELS_JSON`; do not pin model names in skill code.

## Deployment

Skills and tools are version-pinned in Hermes config on the VPS. Bumping a
skill or tool version is a one-line config change followed by the Hermes
redeploy process.
