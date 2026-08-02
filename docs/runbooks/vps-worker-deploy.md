# VPS Worker Deploy — durable `job_queue`

The VPS background worker (`worker/index.ts`) executes Ad Studio recovery,
Meta publish/mutation, lead sync/delivery, reporting refresh, token-health, and
provider-report jobs from the Supabase `job_queue`. Provider execution runs
only here; Vercel routes enqueue work and read durable state.

The worker is not redeployed by Vercel. After changing `worker/**` or any
`src/lib` module the worker imports, redeploy it manually:

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

## Required environment

Store these in `/srv/blockwise/worker-deploy/.env` with mode `0600`:

- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — queue and data access
- `TOKEN_ENCRYPTION_KEY` — must match Vercel or provider-token decryption fails
- `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` — without it, publish/mutation jobs
  fail closed without making Meta writes
- Provider credentials used by the handlers, including Meta and Google

## Verifying

- `docker compose -f docker-compose.worker.yml logs --tail 20` shows
  `[worker …] starting:` and per-job `attempt n/m start` / `completed` lines.
- Failed jobs land in `public.job_queue` with `status='failed'` and a real
  `last_error`; they are never silent.
- Jobs stuck in `processing` past their lease self-heal through
  `reap_stale_jobs`.
