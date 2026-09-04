# Customer operations VPS

Status: draft infrastructure contract. This runbook is for the isolated
`blockwise-customer-ops` Compose project only. It does not change the product
Compose project, product Caddyfile, product migrations, Hermes runtime, DNS,
or production.

## Components and boundaries

`infra/customer-ops/docker-compose.yml` runs Mautic CRM/campaign cron/worker,
Chatwoot web/Sidekiq, and SnagTime web/worker. The Blockwise product
`product-worker` projection lane consumes the durable ops outbox and publishes
the Frank bundle; `ops/control-edge/docker-compose.yml` supplies the private
action/recovery edge. Chatwoot and SnagTime use
independent PostgreSQL databases and login roles. Mautic uses its own MariaDB
database and login because the upstream image requires MySQL/MariaDB. Chatwoot
uses only the private customer-ops Redis instance. Mail is provided by the
existing opt-in `product-mail` service; this stack deliberately has no second
Stalwart server or mail volumes.

The worker and control edge are separate from this customer-ops Compose
project because they use the Blockwise product database and private Frank
networks. Blockwise's existing
`infra/product/systemd/blockwise-email-outbox-drain.*` and
`scripts/vps/email-outbox-drain.sh` remain the outbox contract; this stack does
not duplicate it.

## Prerequisites

- Linux VPS with Docker Engine and Compose v2, `bash`, `openssl`, `getent`,
  `ss`, `nc`, `curl`, and `restic`.
- At least 1 GiB (2--4 GiB recommended) active swap for Chatwoot upgrade
  safety. Provision it under the host's normal change control before
  `--apply`; the installer fails closed when applying without swap.
- A dedicated checkout and `/etc/blockwise/customer-ops/` outside the
  checkout. The env file and every secret file must be mode `0600`; secret
  directory mode is `0700`.
- DNS A/AAAA records for mail, CRM, support, and SnagTime hostnames. Set MX,
  SPF, DKIM, and DMARC for the mail domain; expose SMTP 25 and submission 587
  only after firewall review. IMAPS 993 remains private on the shared mail
  network and must not be published by this stack.
- The separately managed Frank/shared edge must include the reviewed
`infra/customer-ops/Caddyfile.snippets.tmpl` (render with the installer) and attach to
  `blockwise-customer-ops-edge` plus `blockwise-customer-ops-mail`. Do not edit
  the live product Caddyfile as part of this runbook.
- Before validation, an operator must create the narrowly shared mail network
  once (`docker network create --driver bridge blockwise-customer-ops-mail`).
  It is joined only by product-mail and customer-ops mail consumers; do not
  join the product backend network.
  Set product Compose `BLOCKWISE_MAIL_PUBLIC_HOST` to the same hostname as
  customer-ops `MAIL_PUBLIC_HOST`; product-mail receives it as the shared
  network alias so strict SMTP/IMAPS verification uses the Stalwart identity.
  Product-mail must be started with that alias before the customer-ops
  installer check; the installer inspects the live network and fails closed if
  no product-mail container owns the expected alias.
- A restic repository on an off-host target (SFTP, S3, or equivalent) and a
  separate mode-0600 restic password file. Restic encrypts backup contents;
  the repository and password are operator-managed.

## SnagTime image contract

The forked SnagTime `main` at the time this contract was written is
`86f71128af79a0efc6eeac6003a40eb601ff7c4c`. Build the runtime from that exact
merged source revision using SnagTime's own production Dockerfile target, then
publish it to an operator-controlled registry. This repository has no GHCR
publish workflow, so image publication and the resulting digest are an
operator pre-deploy prerequisite. Supply the immutable `SNAGTIME_IMAGE`
reference including its `@sha256:` digest and the full source SHA as
`SNAGTIME_REVISION`; the installer rejects moving tags, undigested images, and
a revision that is not a full lowercase SHA.

The runtime must expose `node apps/web/server.js`, `node dist/worker.mjs`,
`/api/health/live`, and `/api/health/ready`; accept `BUILD_ID`,
`DATABASE_URL_FILE`, `GOOGLE_CLIENT_SECRET_FILE`, and SMTP secret-file
settings. The image must be built from the merged SnagTime main branch, not
from this Blockwise checkout.

## Projection worker and private control edge

Build and publish the Blockwise worker and control-edge images from the same
merged SHA, then set their immutable `@sha256:` references in the operator env
files. The product worker must have `BLOCKWISE_OPS_PROJECTION_WORKER=true`,
`BLOCKWISE_ENABLE_PROVIDER_WRITES=true`, the configured Mautic/Chatwoot source
IDs, and a writable `HERMES_OPS_PROJECTION_ROOT` bind mount owned by the worker
UID. The worker uses `claim_ops_projection` and
`claim_ops_global_projection`, heartbeats leases, reaps expired claims, and
publishes `current.json` only after provider settlement. A lost lease cannot
settle a projection.

The control edge is a separate private Compose project. Set
`CONTROL_EDGE_IMAGE` to its immutable digest and mount only the three
root-owned `0600` files named by `CONTROL_EDGE_*_HOST_FILE`; do not mount the
whole secret directory. Attach it only to the existing `hermes-private` and
`blockwise-product` networks, publish no host port, and require its
`/health/live` Compose healthcheck. `CONTROL_EDGE_WORKER_ENABLED=true` enables
the RPC lease claimant/reaper for append-only action receipts; it retries only
transient executor failures and fails closed on target/version/auth errors.

Validate both rendered contracts before starting either project:

```bash
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile worker config --quiet
docker compose --env-file /etc/blockwise/customer-ops/control-edge.env \
  -f ops/control-edge/docker-compose.yml config --quiet
```

The Frank handoff reads the worker's atomic `current.json` pointer and exact
generation receipt from `HERMES_OPS_PROJECTION_ROOT`. Frank must attach that
mount read-only and reject an expired `fresh_until`, mismatched source
revision/receipt provenance, or a missing publication receipt.

## Install and validate

Copy `infra/customer-ops/customer-ops.env.example` to a path outside the
checkout and replace all example values. Keep API tokens for bootstrap/smoke in
`mautic_api_token` and `chatwoot_api_token` files under the secret directory;
the installer generates only missing random application/database secrets and
never prints their contents.
Google and SMTP provider credentials must already exist as non-empty
mode-0600 files (`google_client_secret`, `mautic_smtp_password`,
`chatwoot_smtp_password`, `snagtime_smtp_password`, and
`chatwoot_inbox_password`, and `chatwoot_webhook_probe_secret`); provider
credentials are never generated. Use
distinct Stalwart SMTP users for Mautic, Chatwoot, and SnagTime. Product-mail bootstrap,
recovery-admin removal, mailbox creation, and mail volume backup/restore
remain governed by `docs/runbooks/stalwart-mail.md` and
`scripts/vps/stalwart-backup.sh`; do not duplicate those credentials or state.

Run the fail-closed check first:

```bash
chmod 600 /etc/blockwise/customer-ops/customer-ops.env
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --check
```

To produce the reviewed edge input without modifying this checkout, add
`--render-caddy /etc/blockwise/customer-ops/Caddyfile.snippets`; the installer
renders and validates the three configured web hostnames. Mail HTTP/JMAP is not
rendered because product-mail keeps that listener private.

The initial check requires DNS resolution, reachable private SMTP submission
port and authenticated STARTTLS for all three service identities, all secret
mounts, immutable SnagTime identity, and quiet `docker compose config`. SMTP
checks run in a build-only ephemeral `smtp-client` container attached solely
to `blockwise-customer-ops-mail`, targeting the `MAIL_PUBLIC_HOST` alias at
the container's submission port; they do not probe a public host port.

```bash
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --apply
docker compose --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml ps
```

After the shared edge is attached and certificates are issued, run the post-edge
TLS gate (web HTTPS plus SMTP STARTTLS certificate validation):

```bash
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --check --post-edge-tls
```

Never use plain `docker compose config` or inspect container environments; both
can render secret values. Database initialization creates separate roles and
databases once, so restore testing must use a newly created, empty Compose
project/volume set.

## Smoke/acceptance

After the edge routes and provider setup are complete, run:

```bash
scripts/vps/customer-ops-smoke.sh --env-file /etc/blockwise/customer-ops/customer-ops.env
```

It reports only pass/fail and status codes. It checks strict SMTP STARTTLS/AUTH
for all three service identities in the pinned ephemeral `smtp-client`, runs support IMAPS
authentication from an ephemeral Chatwoot client on the private mail network,
checks Mautic API authentication, Chatwoot API, SnagTime readiness plus
Google/Calendar configuration, and the configured Frank projection freshness
schema. It sends a signed, non-credentialed probe to the required
`CHATWOOT_WEBHOOK_PROBE_URL` and requires a 2xx response. The bootstrap command
below registers the webhook through Chatwoot's API when `CHATWOOT_WEBHOOK_URL`
is supplied.
It never emits credentials or API response bodies.

Frank freshness must return the PR #118 `/api/ops/overview` contract:
`schema` is `schema://frank.ops/v1`, `version` is `1`, `status` is `ready`,
and `projections` contains exactly `customers`, `email`, `flows`, `mautic`,
`enquiries`, `bookings`, `billing`, `activity`, and `members`. Each projection
must expose its schema/version/status, RFC3339 `published_at` and future
`fresh_until`, a non-empty `source_revision`, receipt-shaped
`source_receipt_ids`, and a receipt-shaped `publication_receipt_id`. A
complete overview uses one source revision, source receipt set, and
publication receipt across all projections. An arbitrary HTTP 2xx is not
accepted. The SnagTime booking and external-mail receipts remain live
acceptance gates after provider setup.

## Mail and customer acceptance

The Mautic entrypoint reads the operator-supplied `mautic_smtp_password` file and
sets its SMTP transport to `${MAIL_PUBLIC_HOST}:587` with STARTTLS. Confirm the
Mautic mailer settings with `customer-ops-bootstrap.sh` and send a controlled
message to an external mailbox. Chatwoot web/worker use the product-mail submission network
with their distinct `chatwoot_smtp_password` identity. After Chatwoot bootstrap, use the
operator-supplied `CHATWOOT_INBOX_USER` and `chatwoot_inbox_password` to create
its email channel with the support mailbox's IMAP host/port
(`${MAIL_PUBLIC_HOST}:993` on the private mail-network alias)
and SMTP host/port (`${MAIL_PUBLIC_HOST}:587`), then perform this receipt-based
acceptance:

1. Send an inbound message from an unrelated external mailbox.
2. Record the resulting Chatwoot conversation/inbox receipt and the signed
   projection receipt published by the Blockwise worker and consumed by Frank.
3. Reply from Chatwoot and verify delivery at the external mailbox over
   authenticated SMTP.

Also create a disposable SnagTime booking, verify the Google Calendar block,
and record the booking/enquiry receipt plus Frank projection freshness. A
health endpoint alone is not customer-operations acceptance.

## Idempotent provider bootstrap

After the SMTP identities exist, run the credential-safe bootstrap against the
same protected env file:

```bash
scripts/vps/customer-ops-bootstrap.sh \
  --env-file /etc/blockwise/customer-ops/customer-ops.env --check
scripts/vps/customer-ops-bootstrap.sh \
  --env-file /etc/blockwise/customer-ops/customer-ops.env --apply
```

`--apply` creates the documented Mautic lifecycle field and registers the
operator-supplied Chatwoot email-inbox JSON and signed webhook URL when those
files/settings are present. Existing resources are accepted as idempotent `409`
conflicts and can be verified again with `--check`; other provider errors fail
closed. The
bootstrap requires explicit lifecycle segment/campaign mappings, distinct
Stalwart identities, and API tokens in root-owned `0600` files. It verifies
GoTrue and transactional-outbox SMTP routing to the shared `product-mail`,
Mautic/Chatwoot API authentication, and SnagTime readiness; it never claims a
signup, external-mail, booking, or action receipt.

## Receipt-based staging smoke matrix

Record each provider receipt ID and the Frank publication receipt in the
staging evidence directory. A health response is not a receipt:

| Flow | Required evidence |
| --- | --- |
| Signup magic link | GoTrue request ID, received message ID, accepted callback/session |
| Transactional mail | `email_outbox` delivery receipt and external mailbox message ID |
| External support mail | Chatwoot inbox/conversation/message IDs, signed webhook receipt, Frank enquiry projection receipt |
| Support reply | Chatwoot outbound message ID and external mailbox message ID |
| Mautic contact/flow | contact ID, lifecycle field/tag, segment and campaign membership receipts |
| SnagTime booking | booking ID, Google event ID, booking projection receipt |
| Control action | action ID, append-only action receipt, target `ops_version` |

The final gate is the Frank `/api/ops/overview` provenance check in
`customer-ops-smoke.sh`: every projection must be ready/fresh and share one
source revision, source receipt set, and publication receipt. Missing provider
credentials, DNS, or any receipt is a failed staging gate, not a synthetic
pass.

## Encrypted backup and restore

Back up to an off-host restic repository; one encrypted snapshot captures
PostgreSQL globals and both application databases, the full Mautic MariaDB,
Mautic config/media, Chatwoot storage, and the existing product-mail Stalwart
config/data. The customer backup invokes the existing Stalwart backup script
into the same staging directory, so the product-mail state is covered by the
same manifest and restic artifact. Stop product-mail under change control
first, as required by `scripts/vps/stalwart-backup.sh`:

```bash
scripts/vps/customer-ops-backup.sh \
  --env-file /etc/blockwise/customer-ops/customer-ops.env \
  --repository sftp:user@backup-host:/srv/restic/customer-ops \
  --password-file /etc/blockwise/customer-ops/restic-password
```

Restore first into a newly created empty directory. The restore script refuses
non-empty targets and requires the coverage manifest before any import:

```bash
install -d -m 700 /srv/blockwise/customer-ops-restore-test
scripts/vps/customer-ops-restore.sh \
  --repository sftp:user@backup-host:/srv/restic/customer-ops \
  --password-file /etc/blockwise/customer-ops/restic-password \
  --snapshot latest \
  --target-empty /srv/blockwise/customer-ops-restore-test \
  --receipt /srv/blockwise/customer-ops-restore-test/restore-receipt.txt
```

The command validates every customer-ops and product-mail artifact, including
the Stalwart SHA256 manifest, and writes a mode-0600 prepared-restore receipt;
it does not claim an import proof. Then import into a newly created isolated
Compose project with a unique name
and fresh volumes. Set `ARTIFACT_DIR` to the directory containing `MANIFEST`:

```bash
export RESTORE_PROJECT=blockwise-customer-ops-restore-$(date -u +%Y%m%d%H%M%S)
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml up -d postgres mariadb redis
# The fresh postgres-init contract recreates the customer_ops/chatwoot/snagtime
# roles and databases. Keep postgres-globals.sql with the receipt for review;
# do not replay its CREATE ROLE/CREATE DATABASE statements over that initialized
# target.
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_restore -U "$POSTGRES_USER" -d chatwoot --exit-on-error' < "$ARTIFACT_DIR/chatwoot.dump"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_owner_password)" pg_restore -U "$POSTGRES_USER" -d snagtime --exit-on-error' < "$ARTIFACT_DIR/snagtime.dump"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml exec -T mariadb sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mautic_db_root_password)" mariadb -uroot' < "$ARTIFACT_DIR/mautic.sql"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml run --rm --no-deps -T --entrypoint sh mautic -c \
  'tar -C /var/www/html/config -xf -' < "$ARTIFACT_DIR/mautic-config.tar"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml run --rm --no-deps -T --entrypoint sh mautic -c \
  'tar -C /var/www/html/docroot/media/files -xf -' < "$ARTIFACT_DIR/mautic-media-files.tar"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml run --rm --no-deps -T --entrypoint sh mautic -c \
  'tar -C /var/www/html/docroot/media/images -xf -' < "$ARTIFACT_DIR/mautic-media-images.tar"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml run --rm --no-deps -T --entrypoint sh chatwoot-web -c \
  'tar -C /app/storage -xf -' < "$ARTIFACT_DIR/chatwoot-storage.tar"
docker volume create "${RESTORE_PROJECT}-mail-config"
docker volume create "${RESTORE_PROJECT}-mail-data"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "${RESTORE_PROJECT}-mail-config:/target" \
  -v "$ARTIFACT_DIR/product-mail/stalwart-config.tar.gz:/backup.tar.gz:ro" \
  --entrypoint sh caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794 \
  -ceu 'test -z "$(find /target -mindepth 1 -print -quit)"; tar -C /target -xzf /backup.tar.gz'
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "${RESTORE_PROJECT}-mail-data:/target" \
  -v "$ARTIFACT_DIR/product-mail/stalwart-data.tar.gz:/backup.tar.gz:ro" \
  --entrypoint sh caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794 \
  -ceu 'test -z "$(find /target -mindepth 1 -print -quit)"; tar -C /target -xzf /backup.tar.gz'
```

The commands above extract the Mautic, Chatwoot, and product-mail tarballs
into fresh isolated volumes using temporary one-shot containers. The
extraction image reference is digest-pinned; replace it only with another verified
immutable digest. Start web/worker services and run health and smoke checks;
append the isolated project name, image digests, and smoke result to the
mode-0600 receipt only after that drill has actually run. Never restore over a
live product or customer-ops volume.

To start the restored product-mail service against those isolated volumes, use
the product Compose file with the restore project and explicit volume names;
never rely on its production defaults:

```bash
export BLOCKWISE_MAIL_CONFIG_VOLUME_NAME="${RESTORE_PROJECT}-mail-config"
export BLOCKWISE_MAIL_DATA_VOLUME_NAME="${RESTORE_PROJECT}-mail-data"
docker compose -p "$RESTORE_PROJECT" --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/coolify/docker-compose.product.yml --profile mail up -d product-mail
```
