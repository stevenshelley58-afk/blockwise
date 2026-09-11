#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only authority check for a Blockwise product release. This script never
# fetches, builds, edits the product environment, or recreates containers.

readonly PRODUCTION_SOURCE_ROOT=/projects/blockwise
readonly PRODUCTION_RELEASE_ROOT=/srv/blockwise/releases/product
readonly PRODUCTION_ENV_FILE=/srv/blockwise/product/.env
readonly PRODUCTION_APP_CONTAINER=blockwise-product-product-app-1
# The release tree under test. Defaults to the canonical checkout; an automated
# release points it at an immutable release worktree so it never depends on
# uncommitted work in the canonical tree. It must stay a worktree of the same
# repository, enforced below.
SOURCE_ROOT="${BLOCKWISE_RELEASE_SOURCE:-$PRODUCTION_SOURCE_ROOT}"
readonly RELEASE_ROOT=$PRODUCTION_RELEASE_ROOT
readonly ENV_FILE=$PRODUCTION_ENV_FILE
readonly APP_CONTAINER=$PRODUCTION_APP_CONTAINER

usage() {
  cat <<'USAGE'
Usage: product-release-preflight.sh <full-git-sha> [--image <immutable-image>] [--check-live]

Checks that the candidate is exactly /projects/blockwise HEAD and origin/main,
that its detached release checkout is clean, and optionally that an immutable
image and the running production app carry the same revision.
USAGE
}

fail() {
  printf '%s\n' "preflight failed: $*" >&2
  exit 2
}

is_full_sha() {
  [[ "$1" =~ ^[a-f0-9]{40}$ ]]
}

read_env_value() {
  local key="$1" line value
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || return 2
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=(.*)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then value="${value:1:${#value}-2}"; fi
    if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then value="${value:1:${#value}-2}"; fi
    printf '%s' "$value"
    return 0
  done < "$ENV_FILE"
  return 1
}

require_same_revision() {
  local observed="$1" subject="$2"
  [[ "$observed" == "$CANDIDATE" ]] || fail "$subject revision does not match candidate"
}

image_revision() {
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1" 2>/dev/null
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

container_revision() {
  docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1" 2>/dev/null
}

container_image_id() {
  docker inspect --format '{{.Image}}' "$1" 2>/dev/null
}

health_revision() {
  local response_file revision
  response_file="$(mktemp)"
  trap 'rm -f "$response_file"' RETURN
  curl --fail --silent --show-error --max-time 10 "$PUBLIC_URL/api/health" -o "$response_file" || fail "public health request failed"
  revision="$(node -e 'const fs=require("fs"); const body=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (body.app !== "blockwise" || body.status !== "ready" || typeof body.revision !== "string") process.exit(2); process.stdout.write(body.revision);' "$response_file" 2>/dev/null)" || fail "public health response is not ready Blockwise with a revision"
  printf '%s' "$revision"
}

IMAGE=""
CHECK_LIVE=false
CHECK_SOURCE_HEAD=true

if (($# == 0)); then
  usage >&2
  exit 2
fi

CANDIDATE="$1"
shift
is_full_sha "$CANDIDATE" || fail "candidate must be a lowercase 40-character Git SHA"

while (($# > 0)); do
  case "$1" in
    --image)
      (($# >= 2)) || fail "--image needs an immutable image reference"
      [[ -z "$IMAGE" ]] || fail "--image may be supplied once"
      IMAGE="$2"
      shift 2
      ;;
    --check-live)
      CHECK_LIVE=true
      shift
      ;;
    --candidate-only)
      # Build-time check. The candidate was already proven to be the fetched
      # main, and the release worktree comes from the object store, so the
      # canonical working tree's own HEAD is not part of this claim.
      CHECK_SOURCE_HEAD=false
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ -d "$SOURCE_ROOT/.git" || -f "$SOURCE_ROOT/.git" ]] || fail "canonical source checkout is unavailable"
# A release worktree is detached at the exact commit under release, so it has no
# branch name. The revision checks below are what pin it.
SOURCE_BRANCH="$(git -C "$SOURCE_ROOT" branch --show-current)"
[[ -z "$SOURCE_BRANCH" || "$SOURCE_BRANCH" == "main" ]] || fail "canonical source is not on main"
if [[ "$SOURCE_ROOT" != "$PRODUCTION_SOURCE_ROOT" ]]; then
  SOURCE_COMMON="$(readlink -f -- "$(git -C "$SOURCE_ROOT" rev-parse --git-common-dir)")" || fail "release source is not a git repository"
  [[ "$SOURCE_COMMON" == "$PRODUCTION_SOURCE_ROOT/.git" ]] || fail "release source is not a worktree of $PRODUCTION_SOURCE_ROOT"
  SOURCE_REAL="$(readlink -f -- "$SOURCE_ROOT")"; RELEASES_REAL="$(readlink -f -- "$RELEASE_ROOT")"
  [[ "$SOURCE_REAL" == "$RELEASES_REAL"/* ]] || fail "release source override must live under $RELEASE_ROOT"
fi
if $CHECK_SOURCE_HEAD; then
  require_same_revision "$(git -C "$SOURCE_ROOT" rev-parse HEAD)" "canonical HEAD"
  require_same_revision "$(git -C "$SOURCE_ROOT" rev-parse origin/main)" "origin/main"
  git -C "$SOURCE_ROOT" diff --quiet HEAD -- || fail "canonical source has tracked changes"
fi

RELEASE_DIR="$RELEASE_ROOT/$CANDIDATE"
[[ -d "$RELEASE_DIR/.git" || -f "$RELEASE_DIR/.git" ]] || fail "candidate release checkout is unavailable"
require_same_revision "$(git -C "$RELEASE_DIR" rev-parse HEAD)" "release checkout"
if git -C "$RELEASE_DIR" symbolic-ref -q HEAD >/dev/null; then
  fail "release checkout must be detached"
fi
[[ -z "$(git -C "$RELEASE_DIR" status --porcelain=v1 --untracked-files=all --ignored=matching)" ]] || fail "release checkout is not pristine"

if [[ -n "$IMAGE" ]]; then
  OBSERVED_IMAGE_REVISION="$(image_revision "$IMAGE")" || fail "image is unavailable"
  require_same_revision "$OBSERVED_IMAGE_REVISION" "image"
fi

if [[ "$CHECK_LIVE" == true ]]; then
  [[ -f "$ENV_FILE" ]] || fail "product environment file is unavailable"
  SELECTED_IMAGE="$(read_env_value BLOCKWISE_APP_IMAGE)" || fail "product image selector is missing"
  ENV_REVISION="$(read_env_value BLOCKWISE_GIT_SHA)" || fail "product revision selector is missing"
  require_same_revision "$ENV_REVISION" "product environment selector"
  if [[ -n "$IMAGE" && "$SELECTED_IMAGE" != "$IMAGE" ]]; then
    fail "product image selector does not match --image"
  fi
  SELECTED_IMAGE_REVISION="$(image_revision "$SELECTED_IMAGE")" || fail "selected image is unavailable"
  require_same_revision "$SELECTED_IMAGE_REVISION" "selected image"
  SELECTED_IMAGE_ID="$(image_id "$SELECTED_IMAGE")" || fail "selected image ID is unavailable"
  CONTAINER_REVISION="$(container_revision "$APP_CONTAINER")" || fail "running app container is unavailable"
  require_same_revision "$CONTAINER_REVISION" "running app container"
  RUNNING_IMAGE_ID="$(container_image_id "$APP_CONTAINER")" || fail "running app image ID is unavailable"
  [[ "$RUNNING_IMAGE_ID" == "$SELECTED_IMAGE_ID" ]] || fail "running app image ID does not match selected image"
  PUBLIC_URL="$(read_env_value BLOCKWISE_PUBLIC_URL)" || fail "public URL is missing"
  require_same_revision "$(health_revision)" "public health"
fi

printf 'product release preflight passed for %s\n' "$CANDIDATE"
