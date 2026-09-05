# Blockwise production readiness

Status: controlled production is health-ready. The cleanup starts from deployed
revision `6f2f92eadc9d7d3b502917d0f59c11c1ed01b1e7`; see release evidence for
the subsequently deployed revision.
This is not sign-off for provider writes, SMTP, billing, Meta App Review, or
data migration.

## Current runtime

The live target is the self-hosted VPS Compose stack behind the shared Frank
Caddy edge: Next standalone app, PostgreSQL, PostgREST, GoTrue, Storage API,
optional Realtime, and a separately gated durable worker. The worker stays
omitted while `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`. Supabase client
packages are protocol clients pointed at the product Caddy origin.

Frank template packs and Hermes research remain separate systems. The main
branch contains divergent customer-ops work and is not an automatic deployment
source. Release provenance must identify the exact full Git SHA and image.

## Health gate

Run from the committed VPS checkout:

    export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
    scripts/vps/product-health.sh <expected-full-git-sha>

Use the full SHA of the candidate release. The script checks the
Compose state, Caddy ingress, JSON `/api/health` readiness, and compiled
revision. Releases before this cleanup do not expose the compiled revision;
for those rollback images, verify the container image ID and retained source
SHA explicitly instead. A no-argument invocation checks readiness only and is not provenance
evidence.

Repository gates are `npm run check:nul`, `npm run test`, `npm run typecheck`,
and `npm run build`. All project work runs on the VPS. Dev-server checks are not release acceptance.

## Separate gates

- Provider writes and worker activation require explicit approval and a tested
  publish path; health-ready does not prove either.
- SMTP/recovery, OAuth callbacks, billing, webhooks, scheduler, and DNS changes
  require their own evidence.
- Migration requires source exports, Auth/object manifests, rehearsal receipts,
  row-count reconciliation, and rollback retention. The repository alone is
  not a production backup.
- Tenant isolation, RLS, storage paths, queue scope, deletion, and provider
  token-vault boundaries remain release requirements.

See [docs/README.md](../README.md), [VPS SSH](vps-ssh.md), and [rollback](rollback.md).
