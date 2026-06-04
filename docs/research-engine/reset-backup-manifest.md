# Reset Backup Manifest

Date: 2026-05-30

This manifest tracks the repository-side backups relevant to the research
runtime hard reset. It does not contain secrets.

## Repository Archives

| Archive | Source role | Retention |
| --- | --- | --- |
| `_archive/research-orchestrator-legacy-20260530/` | Former looping TypeScript research worker | Keep until Hermes-owned collection is accepted |
| `_archive/meta-collector-legacy-20260530/` | Former standalone Playwright collector | Keep until Hermes-owned collection is accepted |

## Data Export Reference

| File | Purpose | Notes |
| --- | --- | --- |
| `research-junk-deletion-backup-2026-05-30.json` | Pre-delete export of junk research rows | Existing top-level backup reference; this agent did not modify it |

## Runtime Config Backups

The previous active runtime can be reconstructed from git history and the
archive paths above. The active compose file now intentionally excludes the
legacy services.

## Retention Rules

1. Keep archive directories through the first successful Hermes-owned build and
   maintain cycles.
2. Do not use archived workers as active runtime services.
3. Do not mount archived worker source into Hermes.
4. Delete archives only after the operator signs off that rollback to the old
   worker runtime is no longer needed.

## Restore Boundaries

A rollback must be explicit. Restoring the old workers means reintroducing
legacy services into compose and revalidating environment variables. It should
not happen through hidden bind mounts or unmanaged containers.
