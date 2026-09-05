# Reproducible standalone Next image for the self-hosted product stack.
FROM node:22-slim AS deps
WORKDIR /app
COPY packages/ad-template-contract/package.json packages/ad-template-contract/package.json
COPY packages/ad-template-renderer/package.json packages/ad-template-renderer/package.json
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

FROM node:22-slim AS builder
WORKDIR /app
ARG GIT_SHA
RUN printf '%s' "$GIT_SHA" | grep -Eq '^[a-f0-9]{40}$'
ENV BLOCKWISE_BUILD_REVISION=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://blockwise.sale
ARG NEXT_PUBLIC_SITE_URL=https://blockwise.sale
ARG NEXT_PUBLIC_SUPABASE_URL=https://blockwise.sale
ARG NEXT_PUBLIC_RESEARCH_STORAGE_URL=https://hermes.blockwise.sale/research-media
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=oss-build-placeholder
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_GOOGLE_ADS_ID=
ARG NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA=false
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_RESEARCH_STORAGE_URL=$NEXT_PUBLIC_RESEARCH_STORAGE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_GOOGLE_ADS_ID=$NEXT_PUBLIC_GOOGLE_ADS_ID
ENV NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA=$NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA
ENV NEXT_TELEMETRY_DISABLED=1
# npm prebuild builds both workspace packages before Next.
RUN npm run build

FROM node:22-slim AS runner
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server must listen on the container interface, not only
# loopback, so the Compose healthcheck and Caddy can reach it.
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
