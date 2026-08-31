# Release Manifest

Status: last-known-good runtime receipt recorded 2026-08-31 from the running
production stack (see `RELEASE-RECONCILIATION.md`). Fields that remain `null`
are pending the reconciled release deploy and the first full CI run.

## Current manifest (running production, srv1625369)

```json
{
  "manifestVersion": 1,
  "releaseId": "runtime-receipt-20260831",
  "sourceSha": "350efcee487e765c61c205ccb42b7099e03f9ac2",
  "sourceRef": "codex/direct-meta-publish-persistence (NOT on main — reconciliation pending)",
  "imageDigest": "sha256:f98c607b49e9328b6a371751d66822af0e3ce441cf4d418292e689fc5675f201",
  "migrationSet": {
    "name": "blockwise_product_migration_ledger (latest 20260830050000_adstudio_manual_colour_mode.sql)",
    "hash": null
  },
  "configurationVersion": "compose sha256:20706487e7a684968a0a417ba5f170713686415c48690acf58651a71fcfaa71e; caddy sha256:a11467e5430b9294b98f349bc173853c87f49370801f85124ffdf47fe73b3b02",
  "backupReceipt": "/srv/blockwise/backups/20260830T051532Z (database.dump, globals.sql, row-counts.json, SHA256SUMS); pre-deploy: pre-935a61d-20260830T091014Z",
  "healthResult": "PASS — /api/health 200 {\"app\":\"blockwise\",\"status\":\"ready\"} at 2026-08-31, compose healthcheck green",
  "rollbackTarget": "blockwise-app:e7719a9c… (image id 56dfdf5fa42c, built 2026-08-30T15:06Z, present on host)"
}
```

Open gaps against the Phase 0 exit gate:

- `migrationSet.hash` — hash of the migration directory at deploy time is not
  yet recorded; capture on the next deploy.
- No restore drill has been executed against the 20260830T051532Z backup yet.
- SBOM/container-scan results are pending the first CI run (workflow commit
  not yet pushed; see reconciliation doc).
- A reconciled release built from canonical `main` (including the five
  production-only commits) has not been deployed; this manifest describes the
  currently running stack, which is last-known-good, not the target release.

Field definitions:

- `sourceSha` — exact git SHA the deployed image was built from (read from the
  running container tag, never inferred from a checkout).
- `imageDigest` — `sha256:...` digest of the deployed container image
  (`docker image inspect` on the running tag).
- `migrationSet` — migration ledger state applied in the running database and
  a hash of the migration directory at deploy time.
- `configurationVersion` — hash/identifier of the runtime configuration in
  force (compose file, Caddyfile, env render or Infisical version).
- `backupReceipt` — reference to the verified pre-deploy backup (id, timestamp, restore check).
- `healthResult` — post-deploy health/readiness probe outcome and URL probed.
- `rollbackTarget` — the previous image/digest this deploy can roll back to
  (see `docs/runbooks/rollback.md`).

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
