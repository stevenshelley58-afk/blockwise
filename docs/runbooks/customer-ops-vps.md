# Customer operations VPS

Status: draft infrastructure contract. This runbook is for the isolated
`blockwise-customer-ops` Compose project only. It does not change the product
Compose project, product Caddyfile, product migrations, Hermes runtime, DNS,
or production.

## Components and boundaries

`infra/customer-ops/docker-compose.yml` runs Stalwart mail/JMAP, Mautic CRM,
campaign cron/worker, Chatwoot web/Sidekiq, and SnagTime web/worker. Chatwoot and
SnagTime use independent PostgreSQL databases and login roles. Mautic uses its
own MariaDB database and login because the upstream Mautic 5 image requires
MySQL/MariaDB. Chatwoot uses only the private customer-ops Redis instance.
Stalwart persists its own configuration/data volumes and does not share an
application database.

The `blockwise-outbox-contract` and `hermes-adapter-contract` services are
disabled placeholder contracts. They exit with status 78 and contain no
implementation. Do not enable those profiles until a reviewed immutable image
and contract are supplied.

## Prerequisites

- Linux VPS with Docker Engine and Compose v2, `bash`, `openssl`, `getent`,
  `ss`, `nc`, `curl`, and `restic`.
- A dedicated checkout and `/etc/blockwise/customer-ops/` outside the
  checkout. The env file and every secret file must be mode `0600`; secret
  directory mode is `0700`.
- DNS A/AAAA records for mail, CRM, support, and SnagTime hostnames. Set MX,
  SPF, DKIM, and DMARC for the mail domain; expose SMTP 25, submission 587,
  SMTPS 465, and IMAPS 993 only after firewall review.
- The separately managed Frank/shared edge must include the reviewed
  `infra/customer-ops/Caddyfile.snippets` and attach to
  `blockwise-customer-ops-edge`. Do not edit the live product Caddyfile as
  part of this runbook.
- A restic repository on an off-host target (SFTP, S3, or equivalent) and a
  separate mode-0600 restic password file. Restic encrypts backup contents;
  the repository and password are operator-managed.

## SnagTime image contract

The forked SnagTime `main` at the time this contract was written is
`86f71128af79a0efc6eeac6003a40eb601ff7c4c`. Build the runtime from that exact
merged source revision using SnagTime's own production Dockerfile target, then
publish it to an operator-controlled registry. Supply the resulting immutable
image reference as `SNAGTIME_IMAGE` and the full source SHA as
`SNAGTIME_REVISION`. The installer rejects moving tags and rejects a revision
that is not a full lowercase SHA.

The runtime must expose `node apps/web/server.js`, `node dist/worker.mjs`,
`/api/health/live`, and `/api/health/ready`; accept `BUILD_ID`,
`DATABASE_URL_FILE`, `GOOGLE_CLIENT_SECRET_FILE`, and SMTP secret-file
settings. The image must be built from the merged SnagTime main branch, not
from this Blockwise checkout.

## Install and validate

Copy `infra/customer-ops/customer-ops.env.example` to a path outside the
checkout and replace all example values. Keep API tokens for the smoke test in
`mautic_api_token` and `chatwoot_api_token` files under the secret directory;
set `CHATWOOT_WEBHOOK_URL` in the env file. The installer generates only
missing random application/database secrets and never prints their contents.
Google and SMTP provider credentials must already exist as non-empty
mode-0600 files (`google_client_secret` and `smtp_password`); provider
credentials are never generated. A temporary secret-backed
`admin:<random>` Stalwart recovery credential is generated for first setup;
remove its secret mount and wrapper after a permanent administrator is created.

Run the fail-closed check first:

```bash
chmod 600 /etc/blockwise/customer-ops/customer-ops.env
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --check
```

After the shared edge is attached and certificates are issued, run the
post-edge TLS gate:

```bash
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --check --post-edge-tls
```

The initial check requires DNS resolution, free mail ports, all secret mounts,
immutable SnagTime identity, and quiet `docker compose config`. After the
shared edge is attached and certificates are issued, run the post-edge TLS
gate:

```bash
scripts/vps/customer-ops-install.sh --env-file /etc/blockwise/customer-ops/customer-ops.env --apply
docker compose --env-file /etc/blockwise/customer-ops/customer-ops.env \
  -f infra/customer-ops/docker-compose.yml ps
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
(with `swaks` installed), Mautic API authentication, Chatwoot API and webhook
reachability, SnagTime readiness plus Google/Calendar configuration, and the
configured Frank projection freshness endpoint. It never emits credentials or
API response bodies.

## Encrypted backup and restore

Back up to an off-host restic repository; the script captures PostgreSQL
globals and both application databases, the full Mautic MariaDB, Stalwart config/data,
Mautic config/media, and Chatwoot storage:

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
  --target-empty /srv/blockwise/customer-ops-restore-test
```

Import dumps/tarballs only into an isolated test Compose project, validate the
health and smoke checks, then record the restore receipt. Never restore over a
live product or customer-ops volume.
