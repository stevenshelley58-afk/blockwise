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
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY worker ./worker

USER worker
ENV NODE_ENV=production

# tini reaps zombies / forwards signals so compose stop kills the worker cleanly.
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "worker/index.ts"]
