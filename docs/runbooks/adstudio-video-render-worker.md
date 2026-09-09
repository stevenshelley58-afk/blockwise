# AdStudio video render worker

The worker is a separate, unprivileged Coolify service. It reads immutable
`VideoAdProject` and `VideoScriptPlan` JSON, renders four template-owned beats
(Hook, Proof, Value, CTA), and writes create-only MP4, poster and WebVTT assets
to private Storage. It never evaluates prompts, JavaScript, or customer-supplied
timeline code. Optional photos are replaced with deterministic kinetic brand
text; missing required assets, rights, consent, or codec attestations fail the
job with a bounded error.

The package keeps the composition contract isolated so a Remotion composition
can replace the native Canvas frame compositor without changing the queue or
storage contracts. The production container includes FFmpeg; FFmpeg produces
H.264 video and AAC audio at 1080x1920, 30 fps. The current
audio track is silence unless an approved music reference is present; music is
attenuated to leave headroom for a future narration track. Remotion is licensed
under its current commercial/open-source terms; confirm the applicable license
for the deployed use before enabling a Remotion renderer.

## Deploy

From the repository checkout on the Coolify host:

```sh
export ADVIDEO_IMAGE='registry.example/blockwise/adstudio-video-renderer@sha256:<image-digest>'
export ADVIDEO_REVISION='<git-commit-sha>'
export SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
export ADVIDEO_MAX_ATTEMPTS=3
docker manifest inspect "$ADVIDEO_IMAGE" >/dev/null
docker compose -f infra/coolify/docker-compose.video-renderer.yml pull
docker compose -f infra/coolify/docker-compose.video-renderer.yml up -d
```

The service requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
environment only. Optional settings are `ADVIDEO_WORKER_NAME`,
`ADVIDEO_POLL_MS`, `ADVIDEO_MAX_ATTEMPTS`, `ADVIDEO_FFMPEG_PATH`, and
`ADVIDEO_OUTPUT_DIR`. Public HTTPS assets are deny-by-default; explicitly set
`ADVIDEO_ALLOWED_ASSET_HOSTS` to a comma-separated host allowlist after review.
Do not put credentials in a compose file or image.

## Health and logs

```sh
docker compose -f infra/coolify/docker-compose.video-renderer.yml ps
docker inspect --format '{{json .State.Health}}' adstudio-video-renderer
docker compose -f infra/coolify/docker-compose.video-renderer.yml run --rm adstudio-video-renderer node --import tsx video-worker/index.ts --health
docker compose -f infra/coolify/docker-compose.video-renderer.yml logs --since=10m -f adstudio-video-renderer
```

Shutdown is graceful: SIGTERM stops new claims, while the active job finishes
or is marked failed by the normal bounded-attempt path.

## Rollback

Set `ADVIDEO_IMAGE` and `ADVIDEO_REVISION` to a previously verified immutable
digest and commit SHA (recorded in the release log), then run:

```sh
docker compose -f infra/coolify/docker-compose.video-renderer.yml up -d
docker compose -f infra/coolify/docker-compose.video-renderer.yml ps
```

Do not run this service alongside another renderer definition. Coolify must
have exactly one stack claiming `ad_video_render_jobs`; stop the current stack
before starting a rollback stack.

Rollback never deletes Storage objects. Create-only object paths are SHA-256
addressed, so rerunning a job is idempotent and cannot overwrite a prior
output. If the bucket rejects JPEG/VTT uploads, apply the storage MIME policy
that permits `image/jpeg` and `text/vtt` before enabling poster/caption output.
