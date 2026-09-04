FROM node:22.15.1-alpine3.21
WORKDIR /app
COPY package*.json ./
COPY ops/control-edge/package.json ops/control-edge/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY src/lib/ops/action-contract.ts src/lib/ops/action-contract.ts
COPY ops/control-edge ops/control-edge
USER node
EXPOSE 8660
CMD ["node", "--experimental-strip-types", "ops/control-edge/src/server.ts"]
