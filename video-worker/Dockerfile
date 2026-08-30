FROM node:22-bookworm-slim
ENV NODE_ENV=production
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.title="Blockwise AdStudio video renderer" \
      org.opencontainers.image.source="https://github.com/stevenshelley58-afk/blockwise" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN node -e 'const [sha, date] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("GIT_SHA must be a full lowercase Git SHA"); if (!date || Number.isNaN(Date.parse(date))) throw new Error("BUILD_DATE must be an ISO timestamp")' "$GIT_SHA" "$BUILD_DATE" \
  && printf '%s\n' "$GIT_SHA" > /app/REVISION
COPY package.json package-lock.json ./
COPY packages/ad-template-contract/package.json packages/ad-template-contract/package.json
COPY packages/ad-template-renderer/package.json packages/ad-template-renderer/package.json
COPY packages/ad-video-renderer/package.json packages/ad-video-renderer/package.json
COPY video-worker/package.json video-worker/package.json
RUN npm ci --include=dev
COPY src src
COPY packages packages
COPY video-worker video-worker
RUN npm run --workspace @blockwise/ad-video-renderer build
USER node
CMD ["node", "--import", "tsx", "video-worker/index.ts"]
