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

FROM node:22-trixie-slim@sha256:a05717adfe7289e2a0fa36a694dc430a510adab6467c7036e51551198935abef AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# npm is needed only while building; removing it from the runtime image
# eliminates unused CLI dependency exposure without changing the app runtime.
RUN sed -i 's|deb.debian.org/debian|snapshot.debian.org/archive/debian/20260904T000000Z|g; s|deb.debian.org/debian-security|snapshot.debian.org/archive/debian-security/20260904T000000Z|g' /etc/apt/sources.list.d/debian.sources \
  && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99snapshot \
  && apt-get update \
  && apt-get install --no-install-recommends -y \
    openssl=3.5.7-1~deb13u2 \
    libssl3t64=3.5.7-1~deb13u2 \
    openssl-provider-legacy=3.5.7-1~deb13u2 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
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
