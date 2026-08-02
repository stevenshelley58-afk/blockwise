# VPS Worker Deploy — immutable, preflighted rollout

The VPS background worker (`worker/index.ts`) is the only provider/background
execution runtime. It consumes Ad Studio recovery, Meta publish/mutation, lead
sync/delivery, reporting refresh, token-health, and provider-report jobs from
Supabase `job_queue`. Vercel routes enqueue work and read durable state; Vercel
deploys do not build or restart this worker.

## Required rollout order

Queue lease changes use an expand/deploy/contract rollout:

1. Apply and verify migration A, which adds the workspace-fenced v2 RPCs
   `enqueue_job_v2`, `cancel_job_v2`, `claim_job_v2`, `heartbeat_job`,
   `complete_job_v2`, and `fail_job_v2` while retaining the legacy RPCs.
2. Deploy and verify the exact green, merged Vercel revision that produces jobs
   through `enqueue_job_v2`/`cancel_job_v2`.
3. Build, preflight, and deploy the v2 worker from that same merged Git SHA.
4. Confirm the web app enqueues through the v2 producer RPCs and the worker
   claims, heartbeats, and settles through the v2 lease RPCs.
5. Only then apply migration B, which removes the legacy producer, claim, and
   settlement RPCs.

Do not reverse steps 1 and 2. Do not apply migration B while a legacy worker
could still be running or an old Vercel deployment can still serve traffic;
that would remove RPCs either runtime still needs.

## Runtime environment

Keep the production values in `/srv/blockwise/worker-deploy/.env` with mode
`0600`. Required names are:

- `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY` (must match Vercel so stored provider tokens decrypt)
- `BLOCKWISE_ENABLE_PROVIDER_WRITES=true`

`STRIPE_SECRET_KEY` is conditionally required only while a workspace can still
use the legacy-trial publication path. It is not a process-start requirement:
reporting, unbilled free-campaign publication, and ordinary paid publication do
not call Stripe. A legacy-trial publish with no key fails closed during billing
validation, before any Meta provider write. Before intentionally supporting a
legacy-trial workspace, provision the key on the VPS and confirm the preflight
report says `"stripeSecretKeyPresent":true`.

Never print this file, run `docker inspect` against a container's environment,
or run plain `docker compose config`; those commands can expose secrets. The
safe Compose validation command is `docker compose config --quiet`.

## Build the exact release

Set `REVISION` to the full 40-character SHA that passed required checks and was
merged. Keep the detached release checkout for audit and rollback; do not build
from a moving `main` checkout.

```bash
set -euo pipefail

REVISION='<full-40-character-merged-sha>'
case "$REVISION" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo 'REVISION must be a full lowercase Git SHA' >&2; exit 1 ;;
esac

RELEASE_ROOT='/srv/blockwise/worker-releases'
RELEASE_DIR="${RELEASE_ROOT}/${REVISION}"
IMAGE="blockwise/worker:${REVISION}"
ENV_FILE='/srv/blockwise/worker-deploy/.env'

mkdir -p "$RELEASE_ROOT"
if [ ! -e "$RELEASE_DIR" ]; then
  git clone --filter=blob:none --no-checkout \
    https://github.com/stevenshelley58-afk/blockwise.git "$RELEASE_DIR"
  git -C "$RELEASE_DIR" fetch --depth 1 origin "$REVISION"
  git -C "$RELEASE_DIR" checkout --detach "$REVISION"
fi
test "$(git -C "$RELEASE_DIR" rev-parse HEAD)" = "$REVISION"
test "$(stat -c '%a' "$ENV_FILE")" = '600'

BUILD_DATE="$(git -C "$RELEASE_DIR" show -s --format='%cI' "$REVISION")"
docker build --pull \
  --build-arg GIT_SHA="$REVISION" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -f "$RELEASE_DIR/worker/Dockerfile" \
  -t "$IMAGE" \
  "$RELEASE_DIR"

test "$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$IMAGE")" = "$REVISION"
```

## Preflight before restart

The preflight runs as the image's non-root user with no network, no writable
filesystem, and no Linux capabilities. It loads the real publish and reporting
handlers, verifies required environment names, and compares the embedded
revision. Its JSON output contains booleans, including optional legacy Stripe
availability, and the Git SHA only; it never prints credentials.

```bash
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env-file "$ENV_FILE" \
  "$IMAGE" \
  node --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  worker/index.ts --preflight --expect-revision "$REVISION"
```

Do not restart unless this returns `"status":"ready"` with both
`publish.meta.execute` and `reporting.refresh` reported as `loaded`.

## Restart the managed service

The committed Compose file is the only worker Compose definition. Supplying the
image and expected revision is mandatory; `--no-build --pull never` prevents a
restart from selecting or producing a different image.

```bash
COMPOSE_FILE="$RELEASE_DIR/worker/docker-compose.worker.yml"
export BLOCKWISE_WORKER_IMAGE="$IMAGE"
export BLOCKWISE_WORKER_ENV_FILE="$ENV_FILE"
export BLOCKWISE_WORKER_EXPECTED_REVISION="$REVISION"

docker compose --project-name worker-deploy \
  -f "$COMPOSE_FILE" config --quiet
docker compose --project-name worker-deploy \
  -f "$COMPOSE_FILE" up -d --no-build --pull never --force-recreate

CID="$(docker compose --project-name worker-deploy \
  -f "$COMPOSE_FILE" ps -q blockwise-worker)"
test -n "$CID"
test "$(docker inspect --format '{{.Config.Image}}' "$CID")" = "$IMAGE"
test "$(docker inspect --format '{{.Image}}' "$CID")" = \
  "$(docker image inspect --format '{{.Id}}' "$IMAGE")"

docker compose --project-name worker-deploy \
  -f "$COMPOSE_FILE" ps
docker compose --project-name worker-deploy \
  -f "$COMPOSE_FILE" logs --tail 30 blockwise-worker
```

The startup line must contain `revision=<REVISION>`. The production Vercel
deployment must report the same Git SHA and be READY before migration B. There
must be no `claim_job_v2 failed`, heartbeat, lost-lease, or settlement errors. Confirm a
real `reporting.refresh` job for a known workspace reaches `completed` before
applying migration B. Use reporting for this rollout proof; do not create a
campaign publish merely to test the queue lease. Enqueue that proof through
the deployed web producer or `enqueue_job_v2`, then confirm the attempt used
the v2 claim, heartbeat, and settlement path in worker logs and queue state.

## Rollback window

Capture the currently running image and its revision before recreation if a
known-good v2 image already exists. Roll back by selecting that immutable image
and revision through the same Compose command. After migration B, never roll
back to a legacy worker or a Vercel revision that uses the legacy producer RPC;
only web and worker revisions that use the v2 contracts can safely enqueue,
claim, and settle jobs.
