# Pre-Reset Inventory

Date: 2026-05-30

This is a static repository inventory captured during the runtime cleanup. No
live VPS commands and no production database commands were run.

## Active Runtime Before Cleanup

`infra/coolify/docker-compose.research.yml` previously defined:

| Service | Status before reset | Reason for removal from active runtime |
| --- | --- | --- |
| `research-orchestrator` | Active looping worker | Duplicated Hermes ownership and used worker-specific env vars |
| `meta-ad-library-collector` | Active standalone collector | Bound legacy worker source into runtime and made collection worker-owned |
| `hermes` | Active | Kept, but changed to the only research runtime owner |
| `uptime-kuma` | Active | Kept as monitoring |

## Legacy Runtime Inputs

The old active compose file referenced these legacy settings:

| Prefix or variable | Former purpose | Reset disposition |
| --- | --- | --- |
| `ORCHESTRATOR_*` | Looping TypeScript worker cadence and dry-run control | Removed from active compose |
| `AD_COLLECTOR_PROVIDER` | Worker provider selector | Removed from active compose |
| `SELF_HOSTED_META_COLLECTOR_URL` | URL for standalone collector | Removed from active compose |
| `META_AD_LIBRARY_COLLECTOR_URL` | URL for standalone collector | Removed from active compose |
| `META_COLLECTOR_*` | Standalone collector configuration | Removed from active compose |
| `SEARCHAPI_*` | Hosted provider configuration for old worker path | Removed from active compose |
| `META_AD_LIBRARY_API_TOKEN` | Optional official API token for old worker path | Removed from active compose |
| `META_GRAPH_VERSION` | Official API version for old worker path | Removed from active compose |

## Source Mounts Before Cleanup

The old active runtime mounted:

| Mount | Status after reset |
| --- | --- |
| `../../workers/meta-ad-library-collector:/app:rw` | Removed |
| `../../workers/meta-ad-library-collector:/opt/blockwise/meta-ad-library-collector:rw` | Removed |
| `collector-profile:/data` | Removed with standalone collector |

Hermes now uses only its data volume in the active compose file.

## Archive State

The repository already contains top-level archive directories for legacy worker
reference:

| Path | Contents |
| --- | --- |
| `_archive/research-orchestrator-legacy-20260530/` | Former TypeScript research orchestrator package |
| `_archive/meta-collector-legacy-20260530/` | Former standalone collector Dockerfile and server |

See `docs/research-engine/reset-backup-manifest.md` and `_archive/MANIFEST.md`
for the manifest view.
