FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
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
