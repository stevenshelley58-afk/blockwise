# Research Engine

Date: 2026-05-30

The research engine is in hard-reset runtime mode. Hermes is the active runtime
owner. The legacy TypeScript orchestrator and standalone Meta collector are
archived and removed from the active compose stack.

## Start Here

| Document | Purpose |
| --- | --- |
| `pre-reset-inventory.md` | What existed before the cleanup |
| `deletion-plan.md` | What was removed from active runtime and what stayed out of scope |
| `reset-backup-manifest.md` | Archive and backup references |
| `pipeline-architecture.md` | Target Hermes-owned architecture |
| `hermes-vps-deployment.md` | VPS deployment contract |
| `env.md` | Environment variables for the reset runtime |
| `data-contracts.md` | Data and quality contracts |
| `build-vs-maintain-mode.md` | Operating modes |
| `operator-runbook.md` | Routine operator checks and stop procedure |
| `removing-old-research-workers.md` | Legacy worker removal details |
| `meta-ad-library-card.md` | App-facing card data contract |

## Active Runtime

Active services in `infra/coolify/docker-compose.research.yml`:

1. `blockwise-hermes`
2. `blockwise-uptime-kuma`

Not active:

1. `research-orchestrator`
2. `meta-ad-library-collector`

## Safety Rules

1. Do not use `:latest` images in the research stack.
2. Do not mount `workers/**` into active runtime containers.
3. Do not treat failed provider runs as zero ads.
4. Do not use broad location discovery, postcode search, suburb search, or
   ad-first discovery in the v1 research build.
5. Keep archived worker copies read-only unless an explicit rollback is planned.
