FROM node:22.15.1-alpine3.21@sha256:152270cd4bd094d216a84cbc3c5eb1791afb05af00b811e2f0f04bdc6c473602
WORKDIR /app
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.title="Blockwise customer-ops control edge" \
      org.opencontainers.image.source="https://github.com/stevenshelley58-afk/blockwise" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
COPY package*.json ./
COPY ops/control-edge/package.json ops/control-edge/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY src/lib/ops/action-contract.ts src/lib/ops/action-contract.ts
COPY ops/control-edge ops/control-edge
RUN node -e 'const [sha, date] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("GIT_SHA must be a full lowercase Git SHA"); if (!date || Number.isNaN(Date.parse(date))) throw new Error("BUILD_DATE must be an ISO timestamp")' "$GIT_SHA" "$BUILD_DATE" \
    && printf '%s\n' "$GIT_SHA" > /app/REVISION
USER node
EXPOSE 8660
CMD ["node", "--experimental-strip-types", "ops/control-edge/src/server.ts"]
