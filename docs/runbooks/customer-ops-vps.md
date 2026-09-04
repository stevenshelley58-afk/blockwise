# Customer operations VPS

Status: draft infrastructure contract. This runbook is for the isolated
`blockwise-customer-ops` Compose project only. It does not change the product
Compose project, product Caddyfile, product migrations, Hermes runtime, DNS,
or production.

## Components and boundaries

`infra/customer-ops/docker-compose.yml` runs Mautic CRM/campaign cron/worker,
Chatwoot web/Sidekiq, and SnagTime web/worker. Chatwoot and SnagTime use
independent PostgreSQL databases and login roles. Mautic uses its own MariaDB
database and login because the upstream image requires MySQL/MariaDB. Chatwoot
uses only the private customer-ops Redis instance. Mail is provided by the
existing opt-in `product-mail` service; this stack deliberately has no second
Stalwart server or mail volumes.

The `hermes-adapter-contract` service is a disabled placeholder contract. It
exits with status 78 and contains no implementation. Blockwise's existing
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

## Install and validate

Copy `infra/customer-ops/customer-ops.env.example` to a path outside the
checkout and replace all example values. Keep API tokens for the smoke test in
`mautic_api_token` and `chatwoot_api_token` files under the secret directory;
set the optional `CHATWOOT_WEBHOOK_PROBE_URL` after a reviewed adapter exists. The installer generates only
missing random application/database secrets and never prints their contents.
Google and SMTP provider credentials must already exist as non-empty
mode-0600 files (`google_client_secret`, `mautic_smtp_password`,
`chatwoot_smtp_password`, `snagtime_smtp_password`, and
`chatwoot_inbox_password`); provider credentials are never generated. Use
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

The initial check requires DNS resolution, reachable SMTP submission port, all
secret mounts, immutable SnagTime identity, and quiet `docker compose config`.

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

It reports only pass/fail and status codes. It checks SMTP STARTTLS and AUTH
(with `swaks` installed), Mautic API authentication, Chatwoot API, SnagTime
readiness plus Google/Calendar configuration, and the configured Frank
projection freshness endpoint. When `CHATWOOT_WEBHOOK_PROBE_URL` is set, it
also sends a signed, non-credentialed probe and requires a 2xx response; until
the adapter contract exists, the webhook assertion is explicitly deferred.
It never emits credentials or API response bodies.

Frank freshness must return the JSON contract
`{"status":"fresh","fresh_until":"<RFC3339 future timestamp>","receipt":"<non-empty receipt>"}`;
an arbitrary HTTP 2xx is not accepted. The SnagTime booking and external-mail
receipts remain live acceptance gates after provider setup.

## Mail and customer acceptance

The Mautic entrypoint reads the operator-supplied `mautic_smtp_password` file and
sets its SMTP transport to `product-mail:587` with STARTTLS. Confirm the
Mautic mailer settings in its UI/API and send a controlled message to an
external mailbox. Chatwoot web/worker use the product-mail submission network
with their distinct `chatwoot_smtp_password` identity. After Chatwoot bootstrap, use the
operator-supplied `CHATWOOT_INBOX_USER` and `chatwoot_inbox_password` to create
its email channel with the support mailbox's IMAP host/port
(`${MAIL_PUBLIC_HOST}:993` on the private mail-network alias)
and SMTP host/port (`product-mail:587`), then perform this receipt-based
acceptance:

1. Send an inbound message from an unrelated external mailbox.
2. Record the resulting Chatwoot conversation/inbox receipt and the signed
   projection receipt (the Hermes adapter remains explicitly deferred).
3. Reply from Chatwoot and verify delivery at the external mailbox over
   authenticated SMTP.

Also create a disposable SnagTime booking, verify the Google Calendar block,
and record the booking/enquiry receipt plus Frank projection freshness. A
health endpoint alone is not customer-operations acceptance.

## Encrypted backup and restore

Back up to an off-host restic repository; the script captures PostgreSQL
globals and both application databases, the full Mautic MariaDB, Mautic
config/media, and Chatwoot storage. Product-mail state is backed up separately
by the existing Stalwart backup script:

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

The command validates every customer-ops artifact and writes a mode-0600
prepared-restore receipt; it does not claim an import proof. Then import into a
newly created isolated Compose project with a unique name
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
  'mariadb -uroot --password="$(cat /run/secrets/mautic_db_root_password)"' < "$ARTIFACT_DIR/mautic.sql"
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
```

The commands above extract the Mautic and Chatwoot tarballs into fresh project
volumes using temporary one-shot containers. Start web/worker services and run
health and smoke checks; append the isolated project name, image digests, and
smoke result to the mode-0600 receipt only after that drill has actually run.
Product-mail state is restored separately under
`docs/runbooks/stalwart-mail.md`; never restore over a live product or
customer-ops volume.
