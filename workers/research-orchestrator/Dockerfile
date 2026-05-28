# Apify orchestrator worker — runs as a long-lived service on the VPS,
# polling research.refresh_policies and calling Apify for due pages.

FROM node:22-alpine AS base
WORKDIR /app

# Dependencies (install at the monorepo root so we resolve the shared
# src/lib/research/ TypeScript modules without copying them).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Source tree we depend on (worker + shared lib + schemas it imports)
COPY src/lib/research ./src/lib/research
COPY workers/research-orchestrator ./workers/research-orchestrator

# Use experimental-strip-types so we run .ts directly. No build step.
ENV NODE_OPTIONS="--experimental-strip-types --no-warnings=ExperimentalWarning"
ENV ORCHESTRATOR_MODE=loop

WORKDIR /app/workers/research-orchestrator
CMD ["node", "src/index.ts"]

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('https://api.apify.com/v2/users/me?token='+process.env.APIFY_API_TOKEN).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
