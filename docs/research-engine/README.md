# Research Engine

Date: 2026-06-12

Hermes is the active research runtime owner. The legacy TypeScript
orchestrator and standalone Meta collector are archived and are not mounted
into the active compose stack.

## Start Here

This index only links documents that exist in `docs/research-engine/`.

| Document | Purpose |
| --- | --- |
| [build-vs-maintain-mode.md](build-vs-maintain-mode.md) | Runtime operating modes and concurrency posture |
| [codex-kickoff.md](codex-kickoff.md) | Original implementation kickoff notes |
| [codex-task-apify-cost-controls.md](codex-task-apify-cost-controls.md) | Apify fallback cost-control contract |
| [data-contracts.md](data-contracts.md) | Research data and quality contracts |
| [deletion-plan.md](deletion-plan.md) | What was removed from active runtime and what stayed out of scope |
| [env.md](env.md) | Environment variables for Hermes, Meta capture, and Apify fallback |
| [go-live.md](go-live.md) | Research runtime go-live checklist |
| [hermes-system-map.md](hermes-system-map.md) | Hermes runtime map |
| [hermes-vps-deployment.md](hermes-vps-deployment.md) | VPS deployment contract |
| [known-limitations.md](known-limitations.md) | Current capture limits and operator expectations |
| [meta-ad-library-card.md](meta-ad-library-card.md) | App-facing Meta Ad Library card data contract |
| [operator-runbook.md](operator-runbook.md) | Routine operator checks and stop procedure |
| [pipeline-architecture.md](pipeline-architecture.md) | Hermes-owned architecture |
| [pre-reset-inventory.md](pre-reset-inventory.md) | What existed before cleanup |
| [real-estate-only-fix.md](real-estate-only-fix.md) | Real-estate-only capture correction |
| [removing-old-research-workers.md](removing-old-research-workers.md) | Legacy worker removal details |
| [reset-backup-manifest.md](reset-backup-manifest.md) | Archive and backup references |
| [simplification-review.md](simplification-review.md) | Rebuild review and simplification notes |

## Active Runtime

Active services in `infra/coolify/docker-compose.research.yml`:

1. `blockwise-hermes`
2. `blockwise-steel`
3. `blockwise-uptime-kuma`

Not active:

1. `research-orchestrator`
2. `meta-ad-library-collector`

## Current Runtime Rules

1. Do not use `:latest` images in the research stack.
2. Do not mount `workers/**` into active runtime containers.
3. Do not treat failed provider runs as zero ads.
4. Keep archived worker copies read-only unless an explicit rollback is planned.
5. Census and page-resolution jobs keep `location_search_allowed: false`; they
   must stay roster/page-first and must not revive broad legacy discovery.
6. Location ad search is enabled by default through
   `HERMES_LOCATION_AD_SEARCH_ENABLED=true`. It is a gated supervisor job for
   Meta Ad Library search coverage, not a ban. Keep its batch, active-count, and
   suburb-per-postcode caps in place.
7. Official Meta Ad Library API capture is enabled only when a configured access
   token is present. Browser capture remains available through Hermes/Steel.
8. Apify is a paid fallback path only. Respect account, monthly, per-run, result,
   and circuit-breaker limits, and do not use the banned
   `apify/facebook-ads-scraper` actor.
