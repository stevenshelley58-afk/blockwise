#!/usr/bin/env bash
# Bound the number of retained release worktrees and release images.
#
# Every release adds a worktree under releases/product, and rollback needs the
# previous one, but nothing ever removed the older ones. This keeps the live
# revision, the rollback revision, the newest N and every release supplying a
# bind mount to a Docker container, then retires the rest with the immutable
# image built for each retired revision.
#
# A release that is not committed and clean is never removed: it is either a
# broken release or someone's work, and neither is this script's to delete.
set -Eeuo pipefail
umask 077

readonly CANONICAL_SOURCE=/projects/blockwise
readonly RELEASES=/srv/blockwise/releases/product
readonly ENV=/srv/blockwise/product/.env
readonly APP_CONTAINER=blockwise-product-product-app-1
readonly SHA_RE='^[a-f0-9]{40}$'
readonly IMAGE_REPO=blockwise-app

KEEP=5
APPLY=false

usage() {
  cat <<'USAGE'
Usage: prune-releases.sh [--keep <n>] [--apply]

Without --apply this reports what it would remove and removes nothing.

Kept regardless of age: the revision serving traffic, the revision the
environment selector records for rollback, the newest <n> (default 5), every
release supplying a bind mount to a Docker container, and any release worktree
that is not clean or not at its own commit. A retired revision takes its
blockwise-app image with it, unless a container still references it.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --keep) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || { usage >&2; exit 2; }; KEEP="$2"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ -d "$RELEASES" ]] || { printf 'no release storage at %s\n' "$RELEASES"; exit 0; }

read_selector() {
  local key="$1" line value
  [[ -f "$ENV" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=(.*)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"; value="${value#\"}"
    printf %s "$value"; return 0
  done < "$ENV"
  return 1
}

# The revision actually serving traffic, preferring the running container.
LIVE_SHA="$(docker inspect "$APP_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^BLOCKWISE_GIT_SHA=//p' | head -1 || true)"
[[ "$LIVE_SHA" =~ $SHA_RE ]] || LIVE_SHA="$(read_selector BLOCKWISE_GIT_SHA || true)"
PREVIOUS_SHA="$(read_selector BLOCKWISE_APP_IMAGE || true)"
PREVIOUS_SHA="${PREVIOUS_SHA##*:}"
[[ "$PREVIOUS_SHA" =~ $SHA_RE ]] || PREVIOUS_SHA=""

mapfile -t ALL < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | grep -E "$SHA_RE" | sort)
# The name is the second field of a "mtime name" line, so it has to be taken
# before the SHA pattern is applied. Matching the anchored pattern against the
# whole line selected nothing at all, which left the newest-N rule protecting
# nothing and every release but the live one retired on sight.
mapfile -t NEWEST < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null \
  | sort -rn | awk '{print $2}' | grep -E "$SHA_RE" | head -n "$KEEP")

# A container can keep using a bind-mounted file after its source release has
# been removed, but it cannot mount that file again after Docker or the host
# restarts. Inspect stopped containers too: restart policies apply to them, and
# deleting their source creates a delayed outage that appears only on reboot.
CONTAINER_ID_LIST=""
if ! CONTAINER_ID_LIST="$(docker ps -aq 2>/dev/null)"; then
  printf 'could not list Docker containers; refusing to prune\n' >&2
  exit 1
fi
CONTAINER_IDS=()
if [[ -n "$CONTAINER_ID_LIST" ]]; then
  mapfile -t CONTAINER_IDS <<< "$CONTAINER_ID_LIST"
fi
CONTAINER_REFERENCED=()
if ((${#CONTAINER_IDS[@]} > 0)); then
  CONTAINER_MOUNTS=""
  if ! CONTAINER_MOUNTS="$(docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "${CONTAINER_IDS[@]}" 2>/dev/null)"; then
    printf 'could not inspect every Docker container; refusing to prune\n' >&2
    exit 1
  fi
  mapfile -t CONTAINER_REFERENCED < <(
    printf '%s\n' "$CONTAINER_MOUNTS" \
      | grep -oE "$RELEASES/[a-f0-9]{40}" \
      | sed 's#^.*/##' \
      | sort -u
  )
fi

is_protected() {
  local sha="$1" kept
  [[ "$sha" == "$LIVE_SHA" || "$sha" == "$PREVIOUS_SHA" ]] && return 0
  for kept in "${NEWEST[@]}"; do [[ "$sha" == "$kept" ]] && return 0; done
  for kept in "${CONTAINER_REFERENCED[@]}"; do [[ "$sha" == "$kept" ]] && return 0; done
  return 1
}

freed=0; removed=0; kept=0
printf 'live: %s\n' "${LIVE_SHA:0:12}"
printf 'rollback selector: %s\n' "${PREVIOUS_SHA:0:12}"
printf 'retaining newest %s, live/rollback, and %s container-mounted release(s)\n\n' \
  "$KEEP" "${#CONTAINER_REFERENCED[@]}"

for sha in "${CONTAINER_REFERENCED[@]}"; do
  [[ -d "$RELEASES/$sha" ]] || {
    printf 'container references missing release %s; refusing to prune\n' "$sha" >&2
    exit 1
  }
done

for sha in "${ALL[@]}"; do
  dir="$RELEASES/$sha"
  if is_protected "$sha"; then
    kept=$((kept + 1)); continue
  fi
  # A release directory that is still registered as a worktree is judged by its
  # git state, and never retired while dirty or not at its own commit. One that
  # is no longer registered, while still named for a commit, is residue: an
  # earlier removal or prune left the directory behind and nothing will use it
  # again. Those are removed without a git check, or gigabytes accumulate
  # silently; three of them were holding 1.5 GB.
  registered=false
  git -C "$CANONICAL_SOURCE" worktree list --porcelain | grep -qxF "worktree $dir" && registered=true
  note=""

  if $registered; then
    if ! git -C "$dir" diff --quiet HEAD -- 2>/dev/null; then
      printf 'skip %s: has uncommitted changes\n' "${sha:0:12}"; kept=$((kept + 1)); continue
    fi
    if [[ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)" != "$sha" ]]; then
      printf 'skip %s: worktree is not at its own commit\n' "${sha:0:12}"; kept=$((kept + 1)); continue
    fi
  else
    note=" [orphaned directory, not a registered worktree]"
  fi

  size="$(du -sb "$dir" 2>/dev/null | cut -f1 || echo 0)"
  freed=$((freed + size)); removed=$((removed + 1))
  if $APPLY; then
    if $registered; then
      git -C "$CANONICAL_SOURCE" worktree remove --force "$dir" 2>/dev/null || rm -rf -- "$dir"
    else
      rm -rf -- "$dir"
    fi
    printf 'removed %s (%s)%s\n' "${sha:0:12}" "$(numfmt --to=iec "$size")" "$note"
  else
    printf 'would remove %s (%s)\n' "${sha:0:12}" "$(numfmt --to=iec "$size")"
  fi
done

if $APPLY; then git -C "$CANONICAL_SOURCE" worktree prune 2>/dev/null || true; fi

# Release images carry a tag naming their revision, and that tag is exactly what
# keeps them: `docker image prune` removes only untagged images, so one image per
# release piled up with nothing to reclaim it. Sixty-nine were on disk when this
# was written, on a volume that was 87 percent full. Images also outlive their
# worktrees, so this walks the images rather than the directories and retires
# each one under the same protection as the worktrees.
image_freed=0; image_removed=0; image_kept=0
mapfile -t IMAGES < <(docker image ls --format '{{.Tag}}' "$IMAGE_REPO" 2>/dev/null | grep -E "$SHA_RE" | sort)
for sha in "${IMAGES[@]}"; do
  image="$IMAGE_REPO:$sha"
  if is_protected "$sha"; then image_kept=$((image_kept + 1)); continue; fi
  # An image a container still references is not this script's to remove, stopped
  # or running, and forcing it out could break a rollback already in flight.
  if [[ -n "$(docker ps -aq --filter "ancestor=$image" 2>/dev/null)" ]]; then
    printf 'skip image %s: a container still uses it\n' "${sha:0:12}"
    image_kept=$((image_kept + 1)); continue
  fi
  # Docker reports an image's whole size, shared base layers included, so this is
  # the size of the images retired rather than the space returned to disk.
  size="$(docker image inspect --format '{{.Size}}' "$image" 2>/dev/null || echo 0)"
  if ! $APPLY; then
    image_freed=$((image_freed + size)); image_removed=$((image_removed + 1))
    printf 'would remove image %s (%s)\n' "${sha:0:12}" "$(numfmt --to=iec "$size")"
    continue
  fi
  if docker image rm "$image" >/dev/null 2>&1; then
    image_freed=$((image_freed + size)); image_removed=$((image_removed + 1))
    printf 'removed image %s (%s)\n' "${sha:0:12}" "$(numfmt --to=iec "$size")"
  else
    printf 'skip image %s: docker refused to remove it\n' "${sha:0:12}"
    image_kept=$((image_kept + 1))
  fi
done

action="$($APPLY && echo removed || echo 'would remove')"
printf '\n%s: %s release(s), %s image(s), %s retained, %s reclaimable\n' \
  "$action" "$removed" "$image_removed" "$((kept + image_kept))" "$(numfmt --to=iec "$((freed + image_freed))")"
$APPLY || printf 'run again with --apply to remove them\n'
