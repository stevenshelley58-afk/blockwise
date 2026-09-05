# VPS Product Worker Deploy

Status: active for the self-hosted product target. The worker is deployed from
the product Compose contract; live cutover remains gated until the product
migration and canary evidence are complete.

The durable worker is the `product-worker` profile in
`infra/coolify/docker-compose.product.yml`. It consumes
`public.job_queue` through the self-hosted PostgREST/Auth contract and runs
provider sync, Meta publish/mutation, lead delivery, reporting refresh, token
health, and Ad Studio recovery. The worker does not run Hermes research or
Frank generation jobs.

Do not start this profile while `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`; the
worker is intentionally omitted during foundation and canary. An offline
preflight only validates an image and does not claim canary readiness.

`@supabase/supabase-js` is used by the worker as a protocol client only.
`NEXT_PUBLIC_SUPABASE_URL` must resolve to the product Caddy origin; it must
not point to a managed Supabase project.

## Required rollout order

Queue lease changes use an expand/deploy/contract rollout:

1. Apply and verify migration A, which adds the workspace-fenced v2 RPCs
   `enqueue_job_v2`, `cancel_job_v2`, `claim_job_v2`,
   `heartbeat_job`, `complete_job_v2`, and `fail_job_v2` while retaining
   the legacy RPCs.
2. Build and deploy the product app from the exact merged Git SHA that produces
   jobs through the v2 producer RPCs.
3. Build, preflight, and deploy the product worker from that same SHA.
4. Confirm the app enqueues through the v2 producer RPCs and the worker claims,
   heartbeats, and settles through the v2 lease RPCs.
5. Only then apply migration B, which removes legacy producer, claim, and
   settlement RPCs.

Do not apply migration B while a legacy app or worker could still be serving
traffic. The product app and worker must move as one immutable release.

## Runtime environment

Keep the rendered product values in `/srv/blockwise/product/.env` with mode
`0600`. Required worker values are:

- `NEXT_PUBLIC_SUPABASE_URL` (the product Caddy origin)
- `SUPABASE_SERVICE_ROLE_KEY` (the self-hosted service-role JWT)
- `TOKEN_ENCRYPTION_KEY` (the same value used by the product app)
- `BLOCKWISE_ENABLE_PROVIDER_WRITES` (`true` is required before starting the
  worker; keep the worker omitted for foundation/canary)
- `BLOCKWISE_WORKER_EXPECTED_REVISION` (the full Git SHA)

The product Compose file injects these values into `product-worker`. Never
print the env, use plain `docker compose config`, or inspect a container's
environment. The worker is read-only, runs without Linux capabilities, and
uses `no-new-privileges`.

When the OSS Mautic/Chatwoot projection lane is enabled, provision these
three root-owned `0600` files before starting the profile:
`/srv/blockwise/secrets/mautic_token`,
`/srv/blockwise/secrets/chatwoot_api_token`, and
`/srv/blockwise/secrets/ops_correlation_key`. Set the corresponding
`*_HOST_FILE` values in the rendered env if the paths differ. Compose mounts
them read-only at the fixed container paths used by Hermes; it never copies
their contents into the image or ordinary environment variables. The worker
also requires `BLOCKWISE_WORKER_REVISION` to be the full 40-character image
SHA so Frank publication provenance cannot fall back to a mutable database
setting.

## Build the exact release

Run the repository release gates before building. Set `REVISION` to the full
40-character lowercase SHA that passed checks and was merged. Build the worker
from that detached source revision; never build from a moving checkout.

~~~bash
set -euo pipefail
REVISION='<full-40-character-merged-sha>'
RELEASE_ROOT='/srv/blockwise/worker-releases'
RELEASE_DIR="$RELEASE_ROOT/$REVISION"
IMAGE="ghcr.io/stevenshelley58-afk/blockwise-worker:$REVISION"
mkdir -p "$RELEASE_ROOT"
git clone --filter=blob:none --no-checkout https://github.com/stevenshelley58-afk/blockwise.git "$RELEASE_DIR"
git -C "$RELEASE_DIR" fetch --depth 1 origin "$REVISION"
git -C "$RELEASE_DIR" checkout --detach "$REVISION"
BUILD_DATE="$(git -C "$RELEASE_DIR" show -s --format='%cI' "$REVISION")"
docker build --pull --build-arg GIT_SHA="$REVISION" --build-arg BUILD_DATE="$BUILD_DATE" -f "$RELEASE_DIR/worker/Dockerfile" -t "$IMAGE" "$RELEASE_DIR"
test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE")" = "$REVISION"
~~~

Use the same SHA and an approved immutable app image for
`BLOCKWISE_APP_IMAGE`. Resolve all image tags to digests for the cutover
record; a tag or successful build alone is not release evidence.

## Preflight before restart

The preflight runs without network, as the image's non-root user, and reports
booleans plus the expected revision without printing credentials:

~~~bash
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --env-file /srv/blockwise/product/.env "$IMAGE" node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON worker/index.ts --preflight --expect-revision "$REVISION"
~~~

Do not restart unless it returns `"status":"ready"` with both
`publish.meta.execute` and `reporting.refresh` reported as `"loaded"`.
Keep the worker omitted until the provider-write gate. Set
`BLOCKWISE_ENABLE_PROVIDER_WRITES=true` only after the app canary and the
reviewed provider-write approval.

## Deploy through product Compose

The product Compose file is the only product worker definition. Set its image
and revision in the rendered env, validate without exposing values, then
recreate only after preflight passes:

~~~bash
cd /projects/blockwise
export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
export COMPOSE_FILE=/projects/blockwise/infra/coolify/docker-compose.product.yml
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime config --quiet
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime up -d --no-build --pull never product-worker
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" --profile worker --profile realtime ps product-worker
docker compose --env-file "$BLOCKWISE_PRODUCT_ENV_FILE" -f "$COMPOSE_FILE" logs --tail 30 product-worker
~~~

The startup log must include `revision=$REVISION`. Verify the running image
label/digest and that the expected revision matches. Run
`scripts/vps/product-health.sh` and confirm a real
`reporting.refresh` job reaches `completed` before applying migration B.
Use reporting for this proof; do not create a campaign merely to test the
queue. After the app/worker release and reporting proof are healthy, run the
canonical post-deploy gate so Frank records fast and de-duplicated full VPS
reconciliation evidence:

~~~bash
scripts/vps/product-post-deploy.sh
~~~

The reconciliation hook is independently disableable. Its failure is recorded
and warned without rolling back an already-healthy Blockwise release.

The standalone `worker/docker-compose.worker.yml` is retained for a
dedicated worker-only deployment. Do not run it alongside `product-worker`
against the same queue; if that mode is used, it must use the same immutable
SHA, env contract, preflight, and rollback controls.

## Rollback window

Capture the currently running worker image digest and revision before
recreation. Roll back by selecting that verified image and revision in the
product env and running the same Compose command with
`--no-build --pull never --force-recreate`. After migration B, never roll
back to a legacy app or worker that still uses removed queue RPCs; roll back
only to a release that uses the v2 contracts.

Do not add Frank/Hermes research migrations, Apify credentials, or Hermes
services to the product Compose project; the separation invariant is documented
in `docs/runbooks/oss-product-migration.md`.
