FROM node:22.15.1-alpine3.21@sha256:152270cd4bd094d216a84cbc3c5eb1791afb05af00b811e2f0f04bdc6c473602
WORKDIR /app
COPY package*.json ./
COPY ops/control-edge/package.json ops/control-edge/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY src/lib/ops/action-contract.ts src/lib/ops/action-contract.ts
COPY ops/control-edge ops/control-edge
USER node
EXPOSE 8660
CMD ["node", "--experimental-strip-types", "ops/control-edge/src/server.ts"]
