# Stalwart mail foundation

Status: deployable foundation; DNS, mailbox provisioning and live acceptance
remain operator gates. This package uses the open-source
`stalwartlabs/stalwart:v0.16.18@sha256:0df5900cab389a8ec47b7521ef0681ec93598caf72a09097685845211861f6c2`
for the documented x86_64 VPS target. The exact patch and amd64 digest were
verified against the [official image tags](https://hub.docker.com/r/stalwartlabs/stalwart/tags)
and [release changelog](https://github.com/stalwartlabs/stalwart/blob/main/CHANGELOG.md).
Re-verify the digest when changing platform or release. No DNS record or
credential is included in this repository.

## Contract

`product-mail` in `infra/coolify/docker-compose.product.yml` is an opt-in
`mail` profile on the existing `blockwise-product` network. Stalwart runs as
its image UID 2000, with `no-new-privileges`, all non-bind capabilities dropped,
a read-only root filesystem, and separate named volumes for `/etc/stalwart`
(configuration, keys, and settings) and `/var/lib/stalwart` (RocksDB data,
queue, mailboxes and blobs). Docker's Stalwart image carries
`cap_net_bind_service`; that capability is intentionally retained so the
unprivileged process can bind SMTP port 25. Do not add `privileged` or drop
that capability.

The Compose contract maps TCP 25 and 587 to loopback by default. Port 25 must
be changed to an externally reachable bind only when inbound mail is a
signed-off requirement; submission defaults to loopback host port 1587 because
GoTrue/outbox use `product-mail:587` over the private Docker network. The HTTP
management/JMAP listener, IMAP, POP3, ManageSieve and HTTPS are not
host-published. If an operator explicitly needs external submission, override
the bind/port and firewall it to approved source ranges. Never permit
unauthenticated relay to the Internet. GoTrue and the transactional outbox share this SMTP transport but
keep separate environment/credential contracts and do not share database
schemas.

The [Supabase Auth SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)
requires a custom SMTP host, port, user, password and From address for signup,
OTP, magic-link, invite and recovery mail. The Compose contract maps those to
`GOTRUE_SMTP_*`; `BLOCKWISE_MAIL_ENABLED=true` makes the app readiness surface
fail closed unless its outbox SMTP settings are complete and the non-secret
`BLOCKWISE_AUTH_SMTP_CONFIGURED=true` receipt is set. The host-side
`mail-validate.sh` checks both separate application and GoTrue SMTP identities
over TLS before that receipt is set. Resend remains explicit compatibility-only
and is not a production readiness path.

## Bootstrap (operator-run, no secrets in Git)

1. Copy `infra/product/.env.example` to `/srv/blockwise/product/.env`, set mode
   `0600`, and inject values through the approved secret manager. Generate a
   long random `STALWART_RECOVERY_ADMIN=admin:<password>` and independent
   Stalwart SMTP account/password values at use site. Never put either in a
   command line, receipt, image, or commit.
2. Set `BLOCKWISE_MAIL_ENABLED=true`, the real mail hostname/public URL, and
   the matching `BLOCKWISE_AUTH_SMTP_*`, `SMTP_*`, sender and admin values. Run:

   ```sh
   set -a; . /srv/blockwise/product/.env; set +a
   scripts/vps/mail-validate.sh
   docker compose --env-file /srv/blockwise/product/.env \
     -f infra/coolify/docker-compose.product.yml --profile mail config --quiet
   docker compose --env-file /srv/blockwise/product/.env \
     -f infra/coolify/docker-compose.product.yml --profile mail up -d product-mail
   docker compose --env-file /srv/blockwise/product/.env \
     -f infra/coolify/docker-compose.product.yml --profile mail ps product-mail
   docker compose --env-file /srv/blockwise/product/.env \
     -f infra/coolify/docker-compose.product.yml --profile mail logs --tail 50 product-mail
   ```

   The service healthcheck is the documented `/healthz/ready` endpoint on the
   private HTTP listener. Use an SSH tunnel or `docker exec product-mail curl`
   for the first `/admin` setup; do not publish port 8080. Complete the wizard
   with the real hostname/domain, local durable stores, TLS certificate/ACME,
   internal directory, and DKIM generation. Create the dedicated sender and a
   controlled acceptance mailbox. Remove `STALWART_RECOVERY_ADMIN` from the
   secret manager and recreate the service after the permanent administrator is
   confirmed. The [Stalwart Docker guide](https://stalw.art/docs/install/platform/docker/)
   documents bootstrap credentials, UID 2000 ownership, `STALWART_PUBLIC_URL`,
   recovery mode and the two durable volume paths.

3. Configure GoTrue and app services after the Stalwart account exists. Run
   `scripts/vps/mail-validate.sh` with the generated application and GoTrue credentials; after
   it returns `gotrueCredentialCheck:true`, set the non-secret
   `BLOCKWISE_AUTH_SMTP_CONFIGURED=true` receipt in the rendered env and
   restart the app:

   ```sh
   docker compose --env-file /srv/blockwise/product/.env \
     -f infra/coolify/docker-compose.product.yml up -d \
     product-auth product-rest product-storage
   scripts/vps/product-health.sh
   ```

   `product-health.sh` additionally requires product-mail to be healthy and
   both SMTP identities to authenticate over TLS. Run the acceptance script
   below against the controlled external hostname to prove end-to-end
   deliverability and token behaviour.

## DNS, TLS and reputation gate

Do not paste guessed values into DNS. The operator supplies the VPS public IP,
mail hostname and generated DKIM selector/key from Stalwart. Publish and verify:

- `A`/`AAAA` for the chosen mail hostname to the VPS address;
- `MX` for each served domain pointing to that mail hostname with an explicit
  priority;
- SPF authorizing only the approved outbound senders/IPs;
- the Stalwart-generated DKIM selector TXT record;
- DMARC with a monitored `rua` address and an intentionally chosen policy;
- provider PTR/rDNS for the VPS address to the mail hostname, with forward DNS
  matching; and
- TLS certificates for the mail hostname. Prefer Stalwart ACME/DNS-01 when the
  shared VPS edge owns 80/443; otherwise complete the documented ACME challenge
  with the required listener temporarily exposed under change control.

Verify with the DNS provider's authoritative lookup and an external SMTP/TLS
probe. Do not call a DNS check from localhost a delivery acceptance.

## Queue, bounces and complaints

Inspect only redacted operational output:

```sh
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile mail logs --tail 100 product-mail
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile mail exec product-mail stalwart-cli --help
```

Use the Stalwart CLI queue commands for the installed release (the command
surface is versioned; confirm with `--help`) and retain queue reports without
message bodies or credentials. The product app includes a deployable,
internal-network-only Stalwart webhook adapter at
`/api/internal/email/stalwart`. Configure a Stalwart WebHook (WebUI Settings ›
Telemetry › Webhooks) with `eventsPolicy=include`,
`events={"delivery.dsn-perm-fail":true}`, `lossy=false`, and URL
`http://product-app:3000/api/internal/email/stalwart`. Set its documented
`signatureKey` from the same use-site-generated `STALWART_WEBHOOK_SECRET` that
is injected into product-app. Stalwart signs the raw request body with HMAC and
sends a base64 digest in `X-Signature`; missing or invalid signatures fail
closed.

```json
{"events":[{"type":"delivery.dsn-perm-fail","data":{"to":"recipient@example.invalid","messageId":"provider-id"}}]}
```

The adapter maps only that documented permanent DSN event into the shared
normalization/storage used by `/api/internal/email/events`, so both paths
cannot drift. It accepts `data.to` as a string or array; a selected event with
no valid recipient returns a retryable 422 instead of being dropped. Current
Stalwart event documentation has no complaint event, so this package maps no
Stalwart event to `complaint`; complaints remain supported only when another
provider posts the generic signed contract. Do not expose this endpoint
publicly or put any secret in Git. See the official [webhook](https://stalw.art/docs/telemetry/webhooks/)
and [event reference](https://stalw.art/docs/ref/events/) for the versioned contract.

## Backup and rollback

Mail state is not covered by the PostgreSQL dump. Before upgrades and during
the cutover window, run:

```sh
set -a; . /srv/blockwise/product/.env; set +a
scripts/vps/stalwart-backup.sh /srv/blockwise/backups/mail/$(date -u +%Y%m%dT%H%M%SZ)
```

The script archives both named volumes read-only and writes `SHA256SUMS` with
mode `0600`. Include both archives and the checksum in the encrypted off-host
backup inventory. The backup script refuses to run while `product-mail` is
running because a live RocksDB/config tar is not a consistent snapshot. Stop
the service and verify its stopped state before running it:

```sh
docker compose --env-file /srv/blockwise/product/.env \
  -f infra/coolify/docker-compose.product.yml --profile mail stop product-mail
scripts/vps/stalwart-backup.sh /srv/blockwise/backups/mail/$(date -u +%Y%m%dT%H%M%SZ)
```

To restore, verify
the checksum, restore the two archives into fresh named volumes owned by UID 2000, validate Compose,
start the exact previously approved image digest, and run the health and SMTP
acceptance checks. Never delete the old volumes during rollback; switch the
volume names/image back in the rendered env and retain both sets until the
retention window expires.

## Acceptance

`scripts/vps/gotrue-mail-acceptance.mjs` defaults to a no-network preflight.
It rejects localhost, Vercel and non-HTTPS targets. For a disposable external
user and controlled Stalwart mailbox, set `BLOCKWISE_ACCEPTANCE_APPLY=true` and
the documented auth/site/JMAP URLs plus mailbox credentials in the protected
runtime environment, then run:

```sh
node scripts/vps/gotrue-mail-acceptance.mjs
```

It POSTs signup (or `BLOCKWISE_ACCEPTANCE_FLOW=magic_link`), polls JMAP for the
message, follows the confirmation exactly once, parses the redirect token in
memory and calls GoTrue `/user` to prove the session is accepted, then verifies
replay rejection. Output contains booleans and status only; it never prints
credentials, links, tokens, message bodies or localhost/Vercel acceptance
evidence. The Compose contract does not expose Stalwart HTTPS/JMAP. The
acceptance mailbox must therefore be a separately exposed, controlled external
JMAP mailbox (or an operator-approved temporary Stalwart HTTPS route), and
must not be presented as product-mail JMAP readiness while that route is
absent.

Inbound operator mail is not configured by SMTP alone. This package leaves the
existing operator inbox UI's Resend receiving adapter quarantined and does not
claim JMAP/IMAP inbox readiness. A provider-neutral Stalwart JMAP/IMAP adapter
belongs in a separate Chatwoot/support work package after access control,
attachment handling, threading and retention are reviewed.
