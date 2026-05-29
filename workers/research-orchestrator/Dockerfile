FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src/lib/research ./src/lib/research
COPY workers/research-orchestrator ./workers/research-orchestrator

ENV NODE_OPTIONS="--experimental-strip-types --no-warnings=ExperimentalWarning"
ENV ORCHESTRATOR_MODE=loop

WORKDIR /app/workers/research-orchestrator
CMD ["node", "src/index.ts"]

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 0 : 1)"
