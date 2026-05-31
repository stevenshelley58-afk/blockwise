# Research Engine Pipeline Architecture

Date: 2026-05-30

This document describes the target architecture after the research runtime hard
reset. It is based on repository state only; no live VPS or production database
commands were run while preparing it.

## Runtime Boundary

Hermes is the only active research runtime in `infra/coolify/docker-compose.research.yml`.
The previous `research-orchestrator` service and standalone
`meta-ad-library-collector` service are removed from the active compose file.

Active services:

| Service | Purpose | Runtime status |
| --- | --- | --- |
| `blockwise-hermes` | Owns research skills, scheduling, decisions, and future collection adapters | Active |
| `blockwise-uptime-kuma` | Local uptime monitor | Active |

Archived legacy code:

| Archive path | Former runtime |
| --- | --- |
| `_archive/research-orchestrator-legacy-20260530/` | Looping TypeScript research orchestrator |
| `_archive/meta-collector-legacy-20260530/` | Standalone Playwright Meta Ad Library collector |

## Ownership Model

Hermes owns the research lifecycle. Legacy workers may be used as reference
material from the archive, but they are not mounted into containers and are not
active services.

| Capability | Owner after reset | Notes |
| --- | --- | --- |
| Agent and agency census | Hermes skill `blockwise-agent-census` | Only evidence-backed census can mark real-estate entities as eligible |
| Page resolution | Hermes skill `blockwise-page-resolver` | Resolves verified entities to Meta advertiser pages |
| Ad collection | Hermes-owned adapter placeholder | Must only collect for verified or resolved real-estate pages |
| Classification | Hermes skill `blockwise-ad-classifier` | Adds intent, ad type, hook, tone, and quality signals |
| Coverage audit | Hermes skill `blockwise-coverage-auditor` | Files defects for gaps instead of ingesting broad postcode sweeps |
| Operator control | Hermes skill `blockwise-operator-chat` and operator APIs | Manual operations must be auditable |

## Flow

1. Census builds or refreshes the verified real-estate roster.
2. Page resolver links verified agents or agencies to advertiser pages.
3. Hermes-owned collection runs against resolved pages only.
4. Raw payloads, screenshots, and media are stored in research storage buckets.
5. Normalized rows are written to `research.*` tables with source evidence.
6. Classifier enriches each creative and records a decision.
7. Views expose only gated real-estate data to the app.
8. Operator runbooks track failures, defects, and manual overrides.

## Quality Gates

| Gate | Requirement |
| --- | --- |
| Roster | Entity has evidence and a decision record before it is trusted |
| Page | Advertiser page is linked to a verified agent or agency before routine collection |
| Collection | Failed runs do not mean zero ads |
| Absence | Marking ads inactive requires successful collection and repeated misses |
| Display | App-facing views must filter through the real-estate gate |
| Audit | Every AI or skill decision writes source evidence, confidence, and rationale |

## Removed Runtime Pattern

The old pattern was worker-first:

1. Run `research-orchestrator` as a loop.
2. Call a standalone `meta-ad-library-collector`.
3. Mount worker source into runtime containers.
4. Configure provider selection with worker-specific environment variables.

That pattern is retired from active runtime. It remains archived for reference
only.

## Placeholder Contract

`infra/coolify/docker-compose.research.yml` defines placeholder environment for
Hermes-owned research execution:

| Variable | Meaning |
| --- | --- |
| `BLOCKWISE_RESEARCH_RUNTIME_OWNER` | Must be `hermes` |
| `HERMES_RESEARCH_MODE` | `build` or `maintain` |
| `BLOCKWISE_RESEARCH_RUNTIME_ENABLED` | Operator-controlled enablement switch |

The placeholders document the intended ownership boundary without re-enabling
the removed worker runtime.
