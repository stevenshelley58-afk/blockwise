# Research Engine Go-Live Runbook

Date: 2026-05-30

This go-live path deploys the hard-reset runtime. This cleanup agent did not run
any live VPS commands.

## Preflight

1. Confirm `HERMES_BASE_IMAGE` is pinned to a concrete tag or digest.
2. Confirm `UPTIME_KUMA_IMAGE` is pinned.
3. Confirm the active compose file has no `research-orchestrator` service.
4. Confirm the active compose file has no `meta-ad-library-collector` service.
5. Confirm no active service mounts `workers/**`.
6. Confirm legacy worker env vars are absent.

## Deploy

Operator-only sequence:

```bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml config --quiet
docker compose -f infra/coolify/docker-compose.research.yml up -d --build hermes uptime-kuma
```

## Verify

Operator-only checks:

```bash
docker compose -f infra/coolify/docker-compose.research.yml ps
curl -fsS http://127.0.0.1:8642/health
curl -fsSI http://127.0.0.1:9119/
curl -fsS http://127.0.0.1:3001
```

Expected:

1. `blockwise-hermes` is running.
2. `blockwise-uptime-kuma` is running.
3. `research-orchestrator` is absent.
4. `meta-ad-library-collector` is absent.
5. Hermes owns all research execution credentials.

## Rollback

Rollback requires an explicit change. Use `_archive/MANIFEST.md` and
`docs/research-engine/reset-backup-manifest.md` to identify legacy sources.
Do not re-enable legacy workers through unmanaged containers or hidden bind
mounts.
