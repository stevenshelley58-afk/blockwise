# AdStudio retirement runbook

1. Deploy the new package runtime and run a new-system Meta PAUSED canary through form readback. Do not begin retirement unless it reaches `paused_ready`; retain its exact provider IDs and report subject hash.
2. Put Blockwise in maintenance mode and stop the VPS publish worker.
3. Run `node scripts/adstudio/prepare-retirement.mjs` on the VPS and store the JSON outside Git. Record its SHA-256, row counts, exact workspace/object IDs, and storage bucket/object IDs.
4. Re-run the inventory immediately before deletion. Abort if counts or IDs changed.
5. For each inventory entry, call Meta with the account-specific provider token in this order: `ad`, `adset`, `creative`, `campaign`, `lead_form`. Record HTTP status and provider response for every exact ID. If Meta rejects a delete, pause and archive the object ID rather than retrying broadly.
6. Export the ID-level provider results and the Supabase inventory to encrypted, time-limited storage. Keep billing and security audit rows, but strip ad payload JSON from retained logs.
7. Delete Blockwise records only by the inventory's `workspace_id` and IDs, in the manifest's exact FK order: queue/lead events → provider attempt/run records → revision/mutation/job records → creative objects/creatives/variants → publish mutations/approvals/plans → copy/compliance/export/campaign records. Remove each exact storage bucket/object only after its owning creative row is deleted. Never delete a workspace, provider connection, billing record, audit log, or shared brand kit/asset.
8. Apply `20260811130000_meta_publish_state_machine_and_legacy_rls.sql`; it refuses to drop the legacy table if it has become non-empty.
9. Re-run the inventory and Supabase security advisor, then resume the worker.
