# OSS Product VPS Migration

Status: target implemented, live cutover gated (2026-08-29). The compose
foundation is present, but the public DNS and provider-write cutover are not
claimed complete. The previous managed endpoint remains only as a retained
rollback source until the gates below are signed off.

## Target architecture

The open-source mail foundation is documented in
[`stalwart-mail.md`](stalwart-mail.md). The optional `product-mail` Compose
profile runs Stalwart with durable config/data volumes and exposes only the
SMTP listeners required by GoTrue/outbox and approved server-to-server mail.
`BLOCKWISE_MAIL_ENABLED=true` is a fail-closed production gate. DNS, TLS,
mailbox credentials, queue operations and external signup acceptance are
separate operator gates; no DNS value or secret is assumed here. SMTP does not
configure the inbound operator inbox: that UI remains a quarantined Resend
compatibility adapter pending a separate JMAP/IMAP support work package.

`infra/coolify/docker-compose.product.yml` is the deployment contract for the
self-hosted product. It runs PostgreSQL 17, PostgREST, GoTrue, Storage API,
an optional Realtime service, and the Next standalone server on the dedicated
`blockwise-product` network. The product Caddy edge is profile-gated and binds
loopback ports by default so it cannot collide with Frank's existing edge on
host ports 80/443. All state is in named volumes; no old Supabase volume is
removed by these files or scripts.

On the shared VPS, Frank's `frank-caddy` must persistently declare an attachment
to the external `blockwise-product` network and its Caddy config must include a
host route for `BLOCKWISE_PRODUCT_DOMAIN` to `product-caddy:80`. Configure that
attachment in Frank's Compose/service definition and redeploy it; a one-off
`docker network connect` is not the final configuration. Do not enable the
`edge` profile until this route is present, because the product edge is not
intended to reclaim public 80/443. Frank terminates public TLS; the internal
product Caddy site is deliberately `http://` so the hop to port 80 cannot
redirect back through the public hostname or start a second ACME flow.

The image tags are reviewable bootstrap pins, not proof that a release is safe
for production. Before the rehearsal, resolve each tag to an approved digest,
record the digest alongside the release SHA, and verify GoTrue/Storage API/
Realtime compatibility with the exported schema.

The application uses `@supabase/supabase-js` as a protocol client only.
`NEXT_PUBLIC_SUPABASE_URL` must point to the self-hosted Caddy origin, never a
managed Supabase project. This preserves the existing Auth UUID,
PostgREST/RPC, RLS, Storage, and WebSocket contracts without making the client
library a managed-service dependency.

Frank and Hermes remain separate execution systems. Frank's generation runs
and template-v2 packs/provenance are self-hosted application artifacts and are
served by the product app/storage contract; they are not a managed Vercel
deployment dependency. Hermes runs research/agent collection and its own
runtime data on the research VPS stack; they are not silently folded into the
product database migration. Any cross-system import must use an explicit,
workspace-scoped API or a reviewed manifest.

## Non-negotiable data contracts

- Export and import `auth.users`, `auth.identities`, recovery metadata, and
  workspace memberships without changing UUIDs. Password hashes and provider
  identity records must be handled using a GoTrue-compatible export/import
  procedure; a normal application table dump is not sufficient.
- Preserve every public-table RLS policy, `auth.uid()`/`auth.jwt()` semantic,
  tenant membership check, RPC signature, and `service_role` boundary. Review
  `infra/product/product-migrations.txt` for the reviewed product migration
  set and Supabase-specific extensions before applying it to the OSS target.
- Create a bucket/object manifest containing exactly five tab-separated fields:
  bucket, object path, SHA-256, byte size, and MIME type. Import private objects
  through the Storage API with `scripts/vps/product-object-copy.sh`; it verifies
  each source and target checksum, byte size, MIME, and the exact bucket/name
  inventory, then writes a restricted completion receipt. Never copy directly
  into the Storage Docker volume: the file backend owns tenant/version paths
  and extended attributes. Never make a private bucket public as a migration
  shortcut.
- Reconcile exact `COUNT(*)` row counts and dump/object checksums before DNS
  cutover.
  `product-backup.sh`, `product-export.sh`, `product-row-counts.sh`, and
  `product-checksums.sh` are the repeatable evidence commands.

## Prerequisites

1. Use a dedicated Ubuntu 24.04 LTS x86_64 VPS for the product stack (baseline
   8 vCPU, 16 GB RAM, 200 GB NVMe plus off-host encrypted backups). This is the
   safest fast path; do not share it with Hermes until a capacity audit proves
   that the research runtime cannot starve PostgreSQL or the app. If the
   documented Hermes VPS is reused, retain separate Compose projects,
   networks, volumes, resource limits, and backup destinations. Add Docker
   Compose, Caddy DNS/TLS, firewall rules, and an Infisical agent or equivalent
   secret injection. Put the rendered env at `/srv/blockwise/product/.env`.
2. Generate a fresh JWT secret and signed anon/service-role JWTs for the same
   secret. Generate a separate Realtime `SECRET_KEY_BASE`; do not reuse a
   provider or token-encryption key. Generate a separate password for the
   PostgREST `authenticator` role; PostgREST must never connect as a superuser.
3. Capture a managed Supabase database dump, globals, Auth export, bucket
   metadata, and object manifest. Store them outside the repository with
   restricted permissions. The current workspace has not captured these live
   artifacts.
4. Rehearse the complete import on a disposable VPS volume, then run the
   application smoke tests for login, signup/recovery, workspace switching,
   invitation acceptance, RLS denial across tenants, RPC queue operations,
   private object download/upload, and reporting invalidation/polling.

## Safe execution sequence

```bash
cp infra/product/.env.example /srv/blockwise/product/.env
# Inject real values from Infisical; never commit the rendered file.
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile realtime config --quiet
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile realtime up -d --no-build --pull never \
  product-db product-rest product-auth product-storage
# Wait for GoTrue and Storage bootstrap health before applying application SQL.
# The migration script reloads PostgREST schema/config before it returns.
scripts/vps/product-backup.sh /srv/blockwise/backups/product/pre-import
# GoTrue and Storage must be healthy first so auth.users and storage.objects
# exist on the fresh target. Apply the reviewed, chronological product list.
BLOCKWISE_MIGRATION_APPROVED=I_HAVE_REHEARSED_ON_A_RESTORE \
  scripts/vps/product-migrate.sh --apply
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml up -d --no-build --pull never product-app
# The edge profile is only for the dedicated internal product Caddy; public
# traffic must arrive through the persistently configured Frank edge route.
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile edge up -d --no-build --pull never product-caddy
# Keep the worker omitted while provider writes are disabled.
scripts/vps/product-health.sh
# Import durable GoTrue users and identities next. UUIDs, password hashes,
# verification state, and provider identities are preserved. Sessions and
# refresh tokens are intentionally excluded because the OSS target has a fresh
# JWT secret, so this cutover forces every user to sign in again.
BLOCKWISE_AUTH_IMPORT_APPROVED=I_HAVE_ACCEPTED_FORCED_REAUTHENTICATION \
  scripts/vps/product-auth-import.sh \
    /srv/blockwise/backups/managed/auth-data.dump \
    --receipt=/srv/blockwise/backups/product/auth-import.receipt \
    --expect-users=9 \
    --expect-identities=9 \
    --apply
BLOCKWISE_IMPORT_APPROVED=I_HAVE_VERIFIED_THE_BACKUP \
  BLOCKWISE_ALLOW_NONEMPTY_IMPORT=false \
  scripts/vps/product-import.sh /srv/blockwise/backups/managed/public-data.dump \
    --public-only \
    --auth-import-receipt=/srv/blockwise/backups/product/auth-import.receipt \
    --apply
# Product migrations create the reviewed private buckets. Import object bytes
# through the Storage API so it creates compatible versions and metadata.
BLOCKWISE_STORAGE_IMPORT_APPROVED=I_HAVE_VERIFIED_THE_OBJECT_MANIFEST \
  scripts/vps/product-object-copy.sh \
    /srv/blockwise-migration/product-objects/manifest.tsv \
    /srv/blockwise-migration/product-objects/objects \
    /srv/blockwise/backups/product/storage-import.receipt \
    --apply
scripts/vps/product-row-counts.sh
```

The phased export creates `auth-data.dump`, `public-data.dump`, and
`storage-data.dump`; each named archive is custom-format, data-only, and
schema-scoped, and the archives are not interchangeable. `product-import.sh`
accepts only the public data phase, stops and verifies every API/worker/writer,
asserts the compatibility schemas exist, and requires no existing rows in the
schemas it will restore (public only) by default. A correctly preloaded Auth
schema therefore does not trip the public-import emptiness guard. The restore
uses `pg_restore --data-only --disable-triggers --single-transaction
--exit-on-error` as a verified superuser for the known circular public foreign
keys; trigger state changes roll back with failed imports, and the script fails
closed if a public user trigger remains disabled after success. Auth is not
restored by the public-data script: `product-auth-import.sh` selects only
`auth.users` and `auth.identities` from the reviewed data-only archive,
refuses non-empty targets, restores transactionally, and verifies exact counts
and identity foreign keys. It deliberately leaves the target's GoTrue schema
ledger, sessions, refresh tokens, MFA session claims, and flow state untouched.
The managed `storage-data.dump` is retained as
rollback evidence but is not restored into the destination Storage schema.
Reviewed product migrations create bucket configuration, and every object is
upserted through the private Storage API so the destination runtime owns its
version, metadata, tenant path, and filesystem attributes. The five-field
manifest and exact API inventory are verified. `product-migrate.sh`
validates the complete allowlist before changing the database, applies its
deliberate chronological dependency order under an advisory lock, and writes
the ledger only after each successful migration. It then sends PostgREST
`reload schema` and `reload config` notifications and performs a controlled
PostgREST restart. Review and apply `globals.sql` before a full rollback restore
when roles are missing.

`product-migrate.sh` reads the explicit product allowlist in
`infra/product/product-migrations.txt` and records each successful migration in
an isolated ledger; it never replays Hermes/research migrations. The worker is
profile-gated and must remain omitted while
`BLOCKWISE_ENABLE_PROVIDER_WRITES=false`; an offline worker preflight is not
canary readiness. Set `BLOCKWISE_WORKER_EXPECTED_REVISION` to the image SHA
and enable that profile only at the reviewed cutover gate. `product-restore.sh` stops API/
worker services and fails on the first restore error. `product-cutover.sh` and
`product-rollback.sh` default to plan-only and never delete old volumes. DNS,
SMTP, OAuth callback URLs, webhook destinations, cron scheduling, and
provider-write enablement are separate reviewed changes.

## Phased implementation batches

1. **Foundation (this change):** isolated compose, pinned image tags, health
   checks, standalone app image, worker, Caddy routes, compatibility bootstrap,
   env contract, guarded backup/restore/reconciliation scripts.
2. **Data rehearsal:** obtain live exports, adapt Supabase migrations and
   GoTrue/Storage migrations, import on disposable volumes, reconcile row/object
   checksums, and run tenant/RLS/Auth tests.
3. **Dual-run/canary:** point a controlled hostname at the VPS, keep provider
   writes disabled, compare read paths and queue behavior, then canary internal
   users while the old project remains available.
4. **Cutover:** freeze writes, take final exports, import/reconcile, switch DNS
   and callbacks, enable worker/provider writes, monitor, and retain the old
   project and volumes for rollback.
5. **Decommission (later, separately approved):** only after the retention
   window and restore rehearsal are complete may managed services be cancelled.

## Known blockers and hazards

- Read-only VPS inspection is confirmed: the existing `frank-caddy` edge and
  the `/projects/blockwise` checkout are present, while the product env is not
  provisioned. Root must render `/srv/blockwise/product/.env` from the approved
  secret manager and persist the Frank edge network attachment/host route before
  enabling the product edge profile.
- No live Auth export, database dump, storage manifest, or current row-count
  baseline is present here. Do not treat repository migrations as a production
  backup.
- Existing code has a few research-schema callers mixed with the post-cutover
  public-schema path. Resolve those call sites during the data-rehearsal batch;
  do not silently map them to public tables.
- Realtime is optional at the compose level because the application has polling
  fallback, but enable it for the reporting invalidation canary until that
  behavior is verified.
- The old deployment docs describe Vercel/managed Supabase and remain historical
  until this runbook's cutover is complete. This runbook is the owner-approved
  OSS target contract.
