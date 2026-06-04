# Removing Old Research Workers

Date: 2026-05-30

The old workers are retired from active runtime but retained in `_archive/` for
reference.

## Removed From Active Compose

| Former service | Removed because |
| --- | --- |
| `research-orchestrator` | Looping worker conflicts with Hermes ownership |
| `meta-ad-library-collector` | Standalone collector keeps collection outside Hermes |

## Removed Mounts

| Former mount | Replacement |
| --- | --- |
| `../../workers/meta-ad-library-collector:/app:rw` | None in active runtime |
| `../../workers/meta-ad-library-collector:/opt/blockwise/meta-ad-library-collector:rw` | None in active runtime |

## Removed Env Vars

The active compose file no longer declares:

1. `ORCHESTRATOR_MODE`
2. `ORCHESTRATOR_LOOP_INTERVAL_MS`
3. `ORCHESTRATOR_MAX_PAGES_PER_TICK`
4. `ORCHESTRATOR_DRY_RUN`
5. `AD_COLLECTOR_PROVIDER`
6. `SELF_HOSTED_META_COLLECTOR_URL`
7. `META_AD_LIBRARY_COLLECTOR_URL`
8. `META_COLLECTOR_*`
9. `SEARCHAPI_*`
10. `META_AD_LIBRARY_API_TOKEN`
11. `META_GRAPH_VERSION`

## What Remains

1. Archive copies under `_archive/`.
2. Documentation describing the old runtime and why it was removed.
3. Hermes runtime placeholders for future collection adapters.

## Operator Verification

After deployment, verify:

1. No active container uses either old service name.
2. No active container has a bind mount under `workers/`.
3. `docker compose config` shows no `:latest` image references.
4. Hermes is the only service with research execution credentials.
