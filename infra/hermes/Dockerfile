# Blockwise Hermes research wrapper.
#
# HERMES_BASE_IMAGE must be a pinned Hermes image tag or digest supplied by the
# operator, for example:
#   ghcr.io/nousresearch/hermes-agent:<version>
#   ghcr.io/nousresearch/hermes-agent@sha256:<digest>
#
# Do not use a floating latest tag in production.

ARG HERMES_BASE_IMAGE
FROM ${HERMES_BASE_IMAGE}

LABEL org.opencontainers.image.title="Blockwise Hermes Research"
LABEL org.opencontainers.image.description="Hermes runtime wrapper for the Blockwise research engine hard reset"

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g agent-browser@0.27.1

COPY hermes/skills /app/skills
COPY hermes/data /app/data
COPY hermes/tools/research-runtime /app/research-runtime
COPY infra/hermes/hermes.toml /app/hermes.toml
COPY infra/hermes/main-wrapper.sh /opt/hermes/docker/main-wrapper.sh

RUN chmod +x /opt/hermes/docker/main-wrapper.sh /app/research-runtime/bin/supabase-supervisor.mjs

EXPOSE 8080

# The base image owns the entrypoint and command routing. Blockwise replaces
# Hermes' main-wrapper with an equivalent wrapper that starts the deterministic
# research supervisor before handing off to Hermes.
