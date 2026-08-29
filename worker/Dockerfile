# VPS background worker for durable provider and recovery jobs.
#
# Runs worker/index.ts directly on Node 22's native type-stripping (same as the
# repo's test runner), so there is no build step: the image ships the TS source
# and Node strips types at load. Only the runtime dep surface the workers need
# (@supabase/supabase-js + ws + node builtins) is installed.
#
# No secrets are baked into the image. NEXT_PUBLIC_SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY and TOKEN_ENCRYPTION_KEY are injected at runtime via
# the compose environment / .env, exactly like the research stack.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r worker && useradd -r -g worker worker

WORKDIR /app
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.title="Blockwise provider worker" \
      org.opencontainers.image.source="https://github.com/stevenshelley58-afk/blockwise" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN node -e 'const [sha, date] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("GIT_SHA must be a full lowercase Git SHA"); if (!date || Number.isNaN(Date.parse(date))) throw new Error("BUILD_DATE must be an ISO timestamp")' "$GIT_SHA" "$BUILD_DATE" \
    && printf '%s\n' "$GIT_SHA" > /app/REVISION \
    && chmod 0444 /app/REVISION

# Git checkout modes depend on the caller's umask. Set image ownership
# explicitly so the non-root runtime can always traverse and read its source.
COPY --from=deps --chown=worker:worker /app/node_modules ./node_modules
COPY --chown=worker:worker package.json ./
COPY --chown=worker:worker src ./src
COPY --chown=worker:worker worker ./worker

USER worker
ENV NODE_ENV=production
ENV BLOCKWISE_WORKER_REVISION="${GIT_SHA}"

RUN test -r worker/index.ts \
    && test -r src/lib/providers/meta-publish-worker.ts \
    && test -r src/lib/meta-monitor/reporting-snapshots.ts

# tini reaps zombies / forwards signals so compose stop kills the worker cleanly.
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "worker/index.ts"]
