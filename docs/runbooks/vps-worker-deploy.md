# VPS Worker Deploy — job_queue publish cutover

The VPS background worker (worker/index.ts) executes `publish.meta.execute`,
`publish.meta.mutate`, `sync.meta.leads`, `deliver.lead`, and
`reporting.refresh` jobs from the Supabase `job_queue`. Publish and mutations
run ONLY here — their Trigger.dev task definitions were removed on 2026-08-02
(see src/lib/providers/meta-publish-queue.ts for why).

The worker is NOT redeployed by Vercel or Trigger deploys. After changing
worker/** or any src/lib module the worker imports, redeploy it manually:

```bash
ssh -i .secrets/vps_key root@76.13.209.160 'set -e; \
  rm -rf /srv/blockwise/deploy-src && \
  git clone --depth 1 https://github.com/stevenshelley58-afk/blockwise.git /srv/blockwise/deploy-src && \
  cd /srv/blockwise/deploy-src && \
  docker build -f worker/Dockerfile -t blockwise/worker:cutover-test . && \
  cd /srv/blockwise/worker-deploy && \
  docker compose -f docker-compose.worker.yml up -d --force-recreate && \
  docker compose -f docker-compose.worker.yml logs --tail 10'
```

## Required env (in /srv/blockwise/worker-deploy/.env)

- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — queue + data access
- `TOKEN_ENCRYPTION_KEY` — MUST match Vercel's value, or provider token
  decryption fails with "Unsupported state or unable to authenticate data"
- `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` — without it every publish/mutation
  job marks its plan failed with a kill-switch message and performs no Meta
  writes
- `BLOCKWISE_QUEUED_KINDS=reporting.refresh` — lets the post-publish reporting
  refresh enqueue back onto the queue instead of falling through to the
  Trigger SDK, which is not installed in the worker image

## Verifying

- `docker compose -f docker-compose.worker.yml logs --tail 20` shows
  `[worker …] starting:` and per-job `attempt n/m start` / `completed` lines.
- Failed jobs land in `public.job_queue` with `status='failed'` and a real
  `last_error` — they are never silent.
- Jobs stuck in `processing` past their lease self-heal via `reap_stale_jobs`.
