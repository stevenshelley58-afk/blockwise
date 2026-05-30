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

COPY hermes/skills /app/skills
COPY infra/hermes/hermes.toml /app/hermes.toml

EXPOSE 8080

# The base image owns the default command.
