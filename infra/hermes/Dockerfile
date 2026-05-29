# Hermes Agent — image is published by Nous Research; we ship a thin
# wrapper that mounts our blockwise-* skills and bakes in a starter
# hermes.toml.
#
# If the upstream image moves, change the FROM. The skill mount is what
# makes this "ours."

FROM ghcr.io/nousresearch/hermes-agent:latest

# Our skills live in /app/skills (read-only at runtime via compose mount,
# baked-in at build time for the container's own files).
COPY hermes/skills /app/skills

# Default hermes.toml; the operator can override via Coolify env or
# bind-mount.
COPY infra/hermes/hermes.toml /app/hermes.toml

EXPOSE 8080

# The base image runs `hermes start` by default.
