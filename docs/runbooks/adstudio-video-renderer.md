# AdStudio video renderer deployment

Production uses the `adstudio-video-renderer` service in
`infra/coolify/docker-compose.product.yml` under the `worker` profile. This is
the only canonical queue consumer definition. The similarly named standalone
Compose file is for isolated validation only and has a `standalone-video`
profile; never run it against the production queue while the product service is
running.

Build and deploy from the exact merged 40-character lowercase SHA:

```sh
REVISION='<full-40-character-merged-sha>'
BUILD_DATE="$(git show -s --format=%cI "$REVISION")"
IMAGE="ghcr.io/stevenshelley58-afk/blockwise-video-renderer:$REVISION"
docker build --pull --build-arg GIT_SHA="$REVISION" --build-arg BUILD_DATE="$BUILD_DATE" \
  -f video-worker/Dockerfile -t "$IMAGE" .
test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE")" = "$REVISION"
```

Push the image through the approved GHCR release process, resolve its digest,
and set these values in `/srv/blockwise/product/.env` (mode `0600`):

```dotenv
BLOCKWISE_VIDEO_WORKER_IMAGE=ghcr.io/stevenshelley58-afk/blockwise-video-renderer@sha256:<verified-digest>
BLOCKWISE_GIT_SHA=<same-40-character-sha>
BLOCKWISE_BUILD_DATE=<commit-ISO-timestamp>
```

Preflight the exact image before starting the profile. Do not use `docker
compose config` with the secret-bearing env file in terminal output.

```sh
docker image inspect "$BLOCKWISE_VIDEO_WORKER_IMAGE" >/dev/null
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --env-file /srv/blockwise/product/.env \
  "$BLOCKWISE_VIDEO_WORKER_IMAGE" node --import tsx video-worker/index.ts --health
docker compose --env-file /srv/blockwise/product/.env \
  -f /projects/blockwise/infra/coolify/docker-compose.product.yml \
  --profile worker up -d --no-build --pull never adstudio-video-renderer
```

Validate health and revision without publishing a port:

```sh
docker compose --env-file /srv/blockwise/product/.env \
  -f /projects/blockwise/infra/coolify/docker-compose.product.yml \
  --profile worker ps adstudio-video-renderer
docker inspect --format '{{json .State.Health}}' adstudio-video-renderer
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' adstudio-video-renderer
docker compose --env-file /srv/blockwise/product/.env \
  -f /projects/blockwise/infra/coolify/docker-compose.product.yml logs --tail 50 adstudio-video-renderer
```

Rollback selects a previously verified GHCR digest and matching SHA, then
recreates only this service with `--pull never`. Keep the current service
stopped before using the standalone profile. Never roll back by tag or run two
renderers against `ad_video_render_jobs`.
