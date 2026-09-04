# Release Manifest

Status: **pending a fresh receipt** (updated 2026-09-04)

This file is a template and audit index. No current production source, image,
migration, backup, health, or rollback claim is made by this document.

## Repository baseline

```json
{
  "manifestVersion": 2,
  "releaseId": "pending-new-receipt",
  "sourceSha": "d0d005ee991532883cfcd1e43cbb744f40d16370",
  "sourceRef": "origin/main at Phase 0 branch creation (2026-09-04)",
  "imageDigest": null,
  "migrationSet": {
    "name": null,
    "hash": null,
    "ledgerReceipt": null
  },
  "configurationVersion": null,
  "backupReceipt": null,
  "restoreDrillReceipt": null,
  "healthResult": null,
  "browserTlsReceipt": null,
  "rollbackTarget": null
}
```

The SHA above is the source baseline for this release-control branch, not a
deployed SHA. The accessible VPS checkout `/projects/ad-template-builder-release`
was historically observed at `e6770c6`; an older receipt cites a running image
built from `350efcee`. Both are historical/unverified until the next receipt.

## Required fields for every deployed release

- exact merged source SHA and immutable OCI image digest (plus build date);
- migration directory SHA-256, applied migration ledger, and schema/content
  comparison against the source export;
- Compose/Caddy/configuration hash with secrets omitted;
- database/Auth/Storage backup and export receipts;
- disposable restore rehearsal and exact row/object/hash reconciliation;
- live health, TLS, OAuth/webhook, and browser smoke receipt;
- prior immutable rollback image and source SHA.

## Deployment receipt template

```markdown
### Deployment receipt — <releaseId>

- Date (UTC): <timestamp>
- Source SHA: <40-character merged SHA> (<ref>)
- Image digest: sha256:<digest>
- Migration set: <names/range>; directory hash: <sha256>; ledger receipt: <path/id>
- Schema/content comparison: <receipt and result>
- Configuration version: <hash/version>
- Backup/export receipt: <id and timestamp>
- Disposable restore receipt: <id and result>
- Health/TLS/browser receipt: <URLs, timestamps, result>
- Rollback target: <previous source SHA / image digest>
- Deployed by/path: <actor and approved path>
- Notes: <deviations, quarantines, follow-ups>
```
