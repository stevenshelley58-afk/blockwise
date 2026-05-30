# Research Engine Operator Runbook

Date: 2026-05-30

This runbook reflects the hard-reset runtime. Commands are for the operator on
the target host; this cleanup agent did not run them.

## Normal State

Expected active containers:

1. `blockwise-hermes`
2. `blockwise-uptime-kuma`

Unexpected active containers:

1. `research-orchestrator`
2. `meta-ad-library-collector`

## Daily Checks

1. Confirm Hermes is healthy.
2. Confirm uptime monitor is healthy.
3. Review failed research runs or defects.
4. Confirm no legacy worker containers are running.
5. Confirm no broad location sweep has produced displayable ads.

## Failed Collection

When collection fails:

1. Record the failure reason.
2. Do not mark ads inactive from that run.
3. File or update a coverage defect.
4. Retry only within the configured budget.
5. Escalate repeated login walls or checkpoints to manual review.

## Rebuilding Coverage

Use build mode only for bounded rebuilds:

1. Set `HERMES_RESEARCH_MODE=build`.
2. Keep `BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false` until the operator is ready.
3. Run census for a specific state, postcode, or agency set.
4. Resolve pages for verified entities.
5. Collect only from resolved verified pages.
6. Return to `HERMES_RESEARCH_MODE=maintain`.

## Emergency Stop

Operator-only sequence:

```bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml stop hermes
```

Do not stop or alter database services from this runbook.

## Rollback Boundary

Rollback to legacy workers is not automatic. If rollback is required, use the
archive manifest, reintroduce services explicitly, and validate all old
environment variables in a separate change.
