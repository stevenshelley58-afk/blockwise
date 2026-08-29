# VPS SSH

Status: active. SSH is the operator path for both the self-hosted product VPS
and the separate Hermes research runtime.

Routine access uses SSH keys over Tailscale; it must not prompt for a password.
The product and research stacks use separate Compose projects, networks,
volumes, environment files, backup destinations, and database migration sets.

## Connection

- Host: `100.78.126.112`
- Routine user: `hermes`
- Provisioning user: `root`
- Operator key: the operator machine's normal SSH key (currently
  `~/.ssh/id_ed25519` on Windows)
- Canonical source checkout: `/projects/blockwise`
- Product env: `/srv/blockwise/product/.env`
- Product backups: `/srv/blockwise/backups/product`
- Hermes private runtime: `/opt/blockwise`

Example:

~~~bash
ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes hermes@100.78.126.112
~~~

`BatchMode=yes` makes a missing key fail clearly instead of falling back to a
password prompt. Do not copy private keys into this repository or create a
project-local key store.

## Product stack checks

Run these checks from the committed checkout. They validate the OSS product
Compose target and Caddy ingress; they do not inspect or print secrets.

~~~bash
cd /projects/blockwise
export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f infra/coolify/docker-compose.product.yml --profile realtime config --quiet
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f infra/coolify/docker-compose.product.yml --profile realtime ps
scripts/vps/product-health.sh
~~~

`product-health.sh` checks service state and requests the configured product
hostname's JSON `/api/health` readiness through the shared Frank edge. For a
direct public check, use the intended HTTPS hostname and verify detailed
`/api/health` output only with its approved bearer token. Do not run plain `docker compose config`, `docker
inspect` against container environments, or commands that print the rendered
env.

Product data operations use the guarded scripts in `scripts/vps/`:
`product-backup.sh`, `product-export.sh`, `product-migrate.sh`,
`product-import.sh`, `product-restore.sh`, `product-row-counts.sh`,
`product-checksums.sh`, `product-object-copy.sh`,
`product-cutover.sh`, and `product-rollback.sh`. Follow
`docs/runbooks/oss-product-migration.md` and
`docs/runbooks/rollback.md`; they require explicit receipts and approval
tokens for mutating operations.

## Worker and research separation

The product worker is the `product-worker` service in the product Compose file
and is enabled with `--profile worker` only after the provider-write gate.
Keep it omitted while `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`; an offline
preflight does not establish canary readiness. Follow
`docs/runbooks/vps-worker-deploy.md` for immutable image build, preflight,
restart, and rollback. It uses the self-hosted Caddy/PostgREST/Auth contract;
`@supabase/supabase-js` is only its protocol client.

Hermes is not part of the product Compose stack. If its separate research
runtime is provisioned, inspect it independently:

~~~bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml config --quiet
docker compose -f infra/coolify/docker-compose.research.yml ps
~~~

Never run product migrations against Hermes schemas or move Frank/Hermes
research data into the product database. Keep environment files, databases,
logs, and generated artifacts outside source checkouts.

## Key enrolment

The matching public key must appear once in the target user's
`~/.ssh/authorized_keys` with directory mode `700` and file mode `600`.
Enrol only the public key. Never transmit or install the private key on the VPS.
