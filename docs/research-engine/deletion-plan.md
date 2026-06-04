# Runtime Deletion Plan

Date: 2026-05-30

This plan covers repository runtime cleanup only. It does not authorize live VPS
commands, database deletion, or edits outside the owned cleanup paths.

## Goals

1. Remove legacy research workers from the active compose runtime.
2. Keep archived reference copies under `_archive/`.
3. Remove worker source mounts from active containers.
4. Remove legacy worker environment variables from active compose.
5. Require pinned runtime images instead of `:latest`.
6. Document Hermes as the research runtime owner.

## Active Compose Removals

| Item | Action |
| --- | --- |
| Service `research-orchestrator` | Removed from `infra/coolify/docker-compose.research.yml` |
| Service `meta-ad-library-collector` | Removed from `infra/coolify/docker-compose.research.yml` |
| Volume `collector-profile` | Removed from `infra/coolify/docker-compose.research.yml` |
| Worker source mounts | Removed from active services |
| `depends_on: [meta-ad-library-collector]` | Removed |
| Unpinned `ghcr.io/nousresearch/hermes-agent:latest` | Replaced by required `HERMES_BASE_IMAGE` build arg |
| Unpinned `louislam/uptime-kuma:latest` | Replaced by pinned default `louislam/uptime-kuma:1.23.16` |

## Items Not Deleted By This Agent

| Path | Reason |
| --- | --- |
| `workers/**` | Out of scope for this cleanup agent |
| `hermes/skills/**` | Out of scope; Hermes skill content owned elsewhere |
| `supabase/**` | Out of scope; no database migration edits in this task |
| `src/**` | Out of scope; app and UI work owned elsewhere |
| `tests/**` | Out of scope; test changes owned elsewhere |

## VPS Deletion Sequence For Operator

These are operator notes, not commands run by this agent.

1. Confirm backups and archive manifests exist.
2. Stop legacy worker services if they still exist on the host.
3. Deploy the updated compose file with only Hermes and uptime monitor active.
4. Verify no container named `research-orchestrator` or
   `meta-ad-library-collector` is running.
5. Keep archived source copies until the replacement Hermes-owned collection
   path has passed acceptance checks.

## Acceptance Criteria

The cleanup is accepted when:

1. Active compose contains no legacy worker services.
2. Active compose contains no worker source bind mounts.
3. Active compose contains no worker-specific collection env vars.
4. Active compose contains no `:latest` image references.
5. Docs identify the archive and operator rollback path.
6. Hermes is documented as the runtime owner.
