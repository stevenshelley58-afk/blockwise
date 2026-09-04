# Blockwise Production Readiness

Status: target implemented, live cutover gated (2026-08-29).

The owner-approved product target is the self-hosted VPS stack defined by
`infra/coolify/docker-compose.product.yml`: Caddy, the Next standalone app,
GoTrue, PostgREST, PostgreSQL, Storage API, optional Realtime, and the durable
worker. The compose foundation is present in the repository; this does not
claim that the public DNS has been cut over. Until the gates below are signed
off, the previous managed endpoint remains available only as a rollback source.

Core product readiness is intentionally independent of external AI and ad
network credentials. Login, workspace access, Ad Studio editing, rendering,
and durable saves use the self-hosted database/auth/storage services and must
boot with `OPENAI_API_KEY`, `META_APP_ID`, and `META_APP_SECRET` unset. Those
values are optional provider gates: `/api/health` reports their individual
missing/invalid status under `readiness.providers` without marking the core
deployment unhealthy. Configure real values only when enabling the relevant
provider; never use example or fake credentials.

The application may use `@supabase/supabase-js` as a protocol client only. It
must point to the self-hosted Caddy origin through `NEXT_PUBLIC_SUPABASE_URL`;
the client library must not be read as evidence that a managed Supabase
runtime is part of the target architecture.

The shared VPS already has Frank's `frank-caddy` edge on host ports 80/443.
Product Caddy is loopback-bound and profile-gated; before enabling its `edge`
profile, persistently attach `frank-caddy` to the external `blockwise-product`
network in Frank's Compose/service definition and add the product hostname host
route to `product-caddy:80`. A one-off `docker network connect` is not a
completed deployment prerequisite.

Current operational references: [OSS migration](oss-product-migration.md),
[VPS SSH](vps-ssh.md), [worker deploy](vps-worker-deploy.md), and
[rollback](rollback.md). Historical managed deployment notes are intentionally
not linked as current runbooks.

## Evidence and release commands

Run runtime checks on the controlled VPS hostname through Caddy. Do not use a
local dev server as launch evidence. The old managed deployment is a rollback
source, not the acceptance target.

| Command | Purpose |
| --- | --- |
| `docker compose --env-file /srv/blockwise/product/.env -f infra/coolify/docker-compose.product.yml --profile edge --profile realtime config --quiet` | Validate the rendered product Compose contract without printing secrets (the worker profile remains omitted) |
| `docker compose ... --profile realtime up -d --no-build --pull never product-db product-rest product-auth product-storage` | Start base services for GoTrue/Storage bootstrap; apply product migrations and reload PostgREST before starting the app/edge |
| `scripts/vps/product-health.sh` | Check Compose state and JSON `/api/health` readiness through the configured hostname and shared Frank edge |
| `scripts/vps/product-post-deploy.sh` | Run the health gate, then request Frank's fixed-input fast/full reconciliation without coupling release health to control-plane availability |
| `scripts/vps/product-backup.sh <directory>` | Capture database dump, globals, exact row counts, and SHA-256 manifest |
| `scripts/vps/product-checksums.sh <directory>/SHA256SUMS` | Verify backup artifacts and print current exact row counts |
| `npm run check:nul`, `npm run typecheck`, `npm test`, `npm run build` | Run repository release gates before building app/worker images |
| `scripts/vps/product-row-counts.sh` | Reconcile public, auth, storage, and private schema counts |

The product scripts read the rendered env through
`BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env`; never print or
commit that file. The worker release must also pass the preflight in
`docs/runbooks/vps-worker-deploy.md`.

## Foundation already implemented

- [x] Product Compose defines isolated named volumes and the
  `blockwise-product` network for PostgreSQL, PostgREST, GoTrue, Storage API,
  optional Realtime, Next, profile-gated Caddy, and the profile-gated
  `product-worker` service plus the opt-in Stalwart `product-mail` profile.
- [x] Stalwart mail configuration/data volumes, SMTP-only host exposure,
  non-root hardening, `/healthz/ready`, fail-closed mail validation, mail
  volume backup, and external GoTrue/JMAP acceptance harness are documented in
  `docs/runbooks/stalwart-mail.md`.
- [x] Caddy routes `/rest/v1`, `/auth/v1`, `/storage/v1`, `/realtime/v1`,
  `/api`, and the Next app while exposing `/healthz`.
- [x] The app and worker images accept an immutable Git revision; the worker
  is read-only, non-root, capability-dropped, and provider-write guarded.
- [x] Guarded backup, export, migration, import, restore, checksum, row-count,
  cutover, rollback, and object-copy scripts exist under `scripts/vps/`.
- [x] Frank template-v2 packs/provenance remain product artifacts, while
  Hermes research/agent execution and research data remain on their separate
  VPS runtime. Product migration must never replay Hermes migrations.

## P0 - Required before live cutover

- [ ] Provision the product VPS and render `/srv/blockwise/product/.env` from
  the example with real secrets injected by the approved secret manager. Use
  distinct JWT, Realtime, PostgREST authenticator, database, and token-
  encryption secrets as documented by the migration runbook.
- [ ] Resolve app/worker/base-service image tags to approved immutable digests;
  record each digest with the full Git SHA and build date.
- [ ] Run the Compose config check and health check with Caddy TLS, then run
  app smoke tests for signup/login/recovery, workspace switching, invitations,
  RLS denial across workspaces, RPC queue operations, private object
  upload/download, and Realtime or polling invalidation.
- [ ] Capture the source database dump, globals, GoTrue-compatible Auth export
  (including unchanged UUIDs, identities, password/recovery metadata), bucket
  metadata, and five-field object manifest outside the repository.
- [ ] Rehearse the complete import on disposable product volumes. Apply only
  the allowlist in `infra/product/product-migrations.txt`; never import
  Hermes/research migrations into the product database.
- [ ] Reconcile exact row counts, Auth UUIDs, object checksums/bytes/MIME, and
  migration receipts with the source export. Keep the old endpoint and all old
  volumes untouched during the retention window.
- [ ] Verify the controlled VPS hostname end to end: OAuth callback URLs,
  SMTP/recovery, Meta connect/disconnect, provider token vault access, Ad
  Studio generation, paused publish flow, leads, billing fallback, health,
  alerting, and deletion behavior.
- [ ] Keep `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` on the app and omit the
  worker through the canary. Enable provider writes and start the worker only
  as a separate, approved cutover gate after publish and human-approval checks
  pass; an offline worker preflight is not canary readiness.
- [ ] Freeze writes, take the final export, switch DNS and external callbacks,
  and only then enable the reviewed worker/provider-write posture. Record the
  exact cutover time and release SHA.

## P1 - Required before real customer data or spend

- [ ] Validate tenant isolation and RLS on every customer path, including
  storage paths, server RPCs, queue payloads, exports, and agent boundaries.
- [ ] Verify Meta App Review, Graph API version, permissions, OAuth, paused
  campaign creation, approval-gated activation/budget changes, and provider
  failure handling with a real test business.
- [ ] Verify signup abuse controls, legal pages, Australian privacy/marketing
  obligations, CSP/HSTS/CSRF/rate limits, operator access controls, and
  deletion/backup retention behavior.
- [ ] Verify durable worker jobs for Meta publish/mutation, lead sync/delivery,
  reporting refresh, token health, provider sync, Ad Studio recovery, retries,
  lease heartbeat, and failure visibility. Scheduled enqueueing is a separate
  VPS scheduler/webhook gate; it is not a Vercel requirement.
- [ ] Configure Sentry, audit drain, email/WhatsApp alerts, off-host encrypted
  backups, and incident ownership. Keep Hermes/Apify credentials only in the
  Hermes runtime and keep Frank/Hermes research data separated.
- [ ] Run desktop and mobile acceptance tests against the controlled VPS
  origin, then repeat the critical smoke checks after DNS cutover.

## Final sign-off record

- [ ] Product VPS hostname and Caddy certificate recorded.
- [ ] Product app/worker image digests, full Git SHA, and deployed timestamp
  recorded.
- [ ] Source export, Auth import receipt, object manifest, backup checksum
  manifest, and exact row-count comparison recorded.
- [ ] DNS, SMTP, OAuth callbacks, webhooks, scheduler, and provider-write
  changes recorded as separate reviewed gates.
- [ ] `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` approved after the canary, with a
  named incident owner and tested rollback.

## Definition of live

Blockwise is live only when the self-hosted product stack serves the intended
public DNS through Caddy, all P0 checks and sign-off evidence are complete,
the final data reconciliation passes, and provider writes are deliberately
enabled. A healthy Compose deployment or a completed migration rehearsal alone
does not mean cutover is complete.
