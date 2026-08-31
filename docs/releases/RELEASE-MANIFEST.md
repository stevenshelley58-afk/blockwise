# Release Manifest

Status: template. Fill one manifest per production deploy and attach it to the
deploy record. Fields with a concrete value below are filled from the current
reconciliation; `null` fields are pending the first deploy receipt.

## Current manifest

```json
{
  "manifestVersion": 1,
  "releaseId": null,
  "sourceSha": "e6770c6c6f7f56e311761804796798231bc70a6b",
  "sourceRef": "origin/main",
  "imageDigest": null,
  "migrationSet": {
    "name": null,
    "hash": null
  },
  "configurationVersion": null,
  "backupReceipt": null,
  "healthResult": null,
  "rollbackTarget": null
}
```

Field definitions:

- `sourceSha` — exact git SHA the deployed image was built from. Filled with
  the reconciled production SHA; update on every deploy.
- `imageDigest` — `sha256:...` digest of the deployed container image (from
  the registry, not the local build tag).
- `migrationSet` — ordered list/name of Supabase migrations applied and a
  hash of the migration directory at deploy time.
- `configurationVersion` — identifier (e.g. env render hash or Infisical
  version) of the runtime configuration in force.
- `backupReceipt` — reference to the verified pre-deploy backup (id, timestamp, restore check).
- `healthResult` — post-deploy health/readiness probe outcome and URL probed.
- `rollbackTarget` — the previous manifest's `sourceSha`/`imageDigest` this
  deploy can roll back to (see `docs/runbooks/rollback.md`).

## Deployment receipt template

Copy this section per deploy, fill every field, and store it with the release
record. A deploy without a completed receipt is not a release.

```markdown
### Deployment receipt — <releaseId>

- Date (UTC): <YYYY-MM-DDTHH:MM:SSZ>
- Source SHA: <git sha> (<ref>)
- Image digest: sha256:<digest>
- Migration set: <names/range> (hash: <hash>)
- Configuration version: <version/hash>
- Backup receipt: <backup id> taken <timestamp>, restore-verified: <yes/no>
- Health result: <pass/fail> via <probe url> at <timestamp>
- Rollback target: <previous sourceSha / imageDigest>
- Deployed by: <actor> via <deploy path>
- Notes: <deviations, quarantines, follow-ups>
```
