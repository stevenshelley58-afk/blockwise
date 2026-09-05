# Rollback Runbook

Status: active for the self-hosted product runtime. See
[production readiness](production-readiness.md) for current release evidence.
Application rollback normally selects the previous retained immutable image;
a data restore or DNS change is a separate operation and needs its own evidence.
Never assume an old managed endpoint is still available.

Before running these commands, export the actual env/Compose paths:

```bash
export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
export COMPOSE_FILE=/path/to/the/verified/release/infra/coolify/docker-compose.product.yml
```

## Current runtime posture

- Caddy is the public ingress for the product VPS and routes the Next
  standalone app, PostgREST, GoTrue, Storage API, and optional Realtime.
- The `product-worker` profile consumes the durable `public.job_queue` through
  the self-hosted PostgREST/Auth contract and performs provider, reporting,
  lead-delivery, and Ad Studio recovery jobs.
- `@supabase/supabase-js` is a protocol client only; its URL must resolve to
  the product Caddy origin, not a managed Supabase project.
- Frank/Hermes separation is a migration invariant; rollback commands affect
  product data only. See `docs/runbooks/oss-product-migration.md`.

## 1. Stop provider writes

Set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` in the rendered product env at
`/srv/blockwise/product/.env`, then stop the worker and recreate the app from
the same immutable image. The worker remains omitted while writes are false;
the flag is checked before Meta publish, Meta mutation, and non-manual lead
delivery.

```bash
export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
export COMPOSE_FILE=/path/to/the/verified/release/infra/coolify/docker-compose.product.yml
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime stop product-worker
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --pull never product-app
```

If the env cannot be changed safely, stop `product-worker` first and leave it
stopped. Preserve queue rows for audit and recovery.

## 2. Pause the product stack or scheduled work

For a full application incident, stop the writers and ingress through the
product Compose contract:

```bash
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime --profile edge stop product-worker product-app product-caddy
```

Scheduled enqueueing is a separate VPS scheduler or webhook configuration.
Disable the affected schedule at that scheduler; there is no Vercel Cron
dependency in the OSS product target. Do not delete queued jobs. Inspect
`public.job_queue` after the worker is stopped and retain the incident evidence.

## 3. Roll back application images

Select the last verified app image digest and set `BLOCKWISE_APP_IMAGE` and
`BLOCKWISE_GIT_SHA` to that release in the product env, then recreate only the
app and edge. Keep the worker omitted while provider writes are false:

```bash
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile realtime --profile edge config --quiet
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile edge up -d --no-build --pull never --force-recreate product-app product-caddy
scripts/vps/product-health.sh <expected-full-git-sha>
```

Releases predating the compiled-revision endpoint need explicit container image-ID
and retained-source verification instead of the revision argument. A no-argument
health check only proves readiness. Never build from a moving checkout during rollback. Verify the Caddy `/healthz`
response, app `/api/health`, and provider-write flag before resuming traffic.
Only after a separate provider-write approval should the verified worker image
and revision be selected and started with `--profile worker`.

## 4. Restore database, Auth, and Storage

`product-rollback.sh` is plan-only unless explicitly approved. First verify the
backup manifest, then run the guarded restore with the selected dump and
globals:

```bash
scripts/vps/product-checksums.sh /srv/blockwise/backups/product/<stamp>/SHA256SUMS
BLOCKWISE_ROLLBACK_APPROVED=I_HAVE_VERIFIED_THE_ROLLBACK_PLAN scripts/vps/product-rollback.sh --apply
BLOCKWISE_RESTORE_APPROVED=I_HAVE_VERIFIED_THE_BACKUP scripts/vps/product-restore.sh /srv/blockwise/backups/product/<stamp>/database.dump --globals=/srv/blockwise/backups/product/<stamp>/globals.sql --apply
```

The restore script stops product API/worker writers, applies optional role
globals, and uses a single-transaction `pg_restore`; it does not remove named
volumes. Restore Auth users, identities, password/recovery metadata, and
Storage metadata/objects through their GoTrue/Storage compatibility procedures.
Do not restore `auth.*` with a generic application dump and do not make private
storage buckets public. Run `product-row-counts.sh`, reconcile the five-field
object manifest, run tenant/RLS/Auth smoke tests, and only then restart services.

## 5. Return DNS to the previous endpoint

Only if a retained previous endpoint has been verified healthy and data-consistent,
disable provider writes and route public DNS/upstream traffic back to it. If no
verified endpoint remains, do not change DNS; restore a retained app image first. Keep
the product Caddy volumes, database dump, Auth receipt, and object manifest
intact for forensic review and a later retry. DNS, SMTP, OAuth callbacks,
webhooks, and scheduler changes are separate gates and must be reverted as a
coordinated set.

## Quick reference

| Symptom | First action |
| --- | --- |
| Unexpected Meta/provider mutation | Set provider writes false; stop `product-worker` |
| Unsafe queue behavior | Stop `product-worker`; preserve `public.job_queue` |
| Bad app release | Re-select the last verified immutable images and recreate Compose services |
| Corrupt or incomplete data | Verify `SHA256SUMS`, then use guarded `product-restore.sh` |
| VPS ingress failure | Return DNS/upstream to the retained previous endpoint |
| Unexpected spend | Disable provider writes and pause affected objects in the provider console |

After rollback, record the incident window, affected workspaces/jobs, release
SHA and image digests, data manifests, actions taken, and the prevention change.
