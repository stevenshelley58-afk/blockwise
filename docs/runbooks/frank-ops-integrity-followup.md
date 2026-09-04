# Frank operations-bundle integrity handoff

The Blockwise worker writes a `manifest.json` beside each Frank `schema://frank.ops/v1`
generation. It contains SHA-256 hashes for every projection file,
`publication-receipt.json`, the exact `current.json` pointer, and the aggregate
bundle hash. The active Frank #121 reader intentionally rejects unknown keys in
the pointer and publication receipt and therefore does not consume this sidecar.
The manifest is not an integrity guarantee until Frank verifies it.

The active Frank consumer must add this focused, backwards-compatible check:

1. After reading `current.json`, read the same generation's `manifest.json`.
2. Require `schema = schema://frank.ops-manifest/v1`, version `1`, matching
   `generation` and `publication_receipt_id`.
3. Recompute SHA-256 for each listed projection and
   `publication-receipt.json`; compare exact lowercase hex values.
4. Recompute `pointer_sha256` from the exact bytes of `current.json`, and
   `bundle_sha256` from the canonical manifest file map; reject the generation
   on any mismatch, missing file, path traversal, or stale receipt.
5. Keep the strict existing pointer/receipt schema and surface an integrity
   error in Frank's read-only UI.

Until that Frank-side change is deployed, the manifest is diagnostic evidence,
not a claimed consumer-enforced integrity boundary. The worker continues to
publish only the exact Frank #121-compatible pointer and receipt shapes.
