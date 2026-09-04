# Reproducible standalone Next image for the self-hosted product stack.
# Pin the multi-architecture base by digest so the release image and its
# vulnerability/SBOM evidence cannot drift while a workflow is running.
FROM node:22-trixie-slim@sha256:a05717adfe7289e2a0fa36a694dc430a510adab6467c7036e51551198935abef AS deps
WORKDIR /app
COPY packages/ad-template-contract/package.json packages/ad-template-contract/package.json
COPY packages/ad-template-renderer/package.json packages/ad-template-renderer/package.json
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

FROM node:22-trixie-slim@sha256:a05717adfe7289e2a0fa36a694dc430a510adab6467c7036e51551198935abef AS builder
WORKDIR /app
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
RUN npm run build:packages
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:4e4fb0ce55fd73901600796ef079a9490369d2515d7da31633a91608c82ca13b AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server must listen on the container interface, not only
# loopback, so the Compose healthcheck and Caddy can reach it.
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=65532:65532 /app/public ./public
COPY --from=builder --chown=65532:65532 /app/.next/standalone ./
COPY --from=builder --chown=65532:65532 /app/.next/static ./.next/static
EXPOSE 3000
CMD ["server.js"]
