#!/usr/bin/env bash
# Bound the number of retained release worktrees.
#
# Every release adds a worktree under releases/product, and rollback needs the
# previous one, but nothing ever removed the older ones. This keeps the live
# revision, the rollback revision and the newest N, then retires the rest.
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

KEEP=5
APPLY=false

usage() {
  cat <<'USAGE'
Usage: prune-releases.sh [--keep <n>] [--apply]

Without --apply this reports what it would remove and removes nothing.

Kept regardless of age: the revision serving traffic, the revision the
environment selector records for rollback, the newest <n> (default 5), and any
release worktree that is not clean or not at its own commit.
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
mapfile -t NEWEST < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' 2>/dev/null \
  | grep -E "$SHA_RE"'$' | sort -rn | head -n "$KEEP" | awk '{print $2}')

is_protected() {
  local sha="$1" kept
  [[ "$sha" == "$LIVE_SHA" || "$sha" == "$PREVIOUS_SHA" ]] && return 0
  for kept in "${NEWEST[@]}"; do [[ "$sha" == "$kept" ]] && return 0; done
  return 1
}

freed=0; removed=0; kept=0
printf 'live: %s\n' "${LIVE_SHA:0:12}"
printf 'rollback selector: %s\n' "${PREVIOUS_SHA:0:12}"
printf 'retaining newest %s plus the two above\n\n' "$KEEP"

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

printf '\n%s: %s release(s), %s retained, %s reclaimable\n' \
  "$($APPLY && echo removed || echo would remove)" "$removed" "$kept" "$(numfmt --to=iec "$freed")"
$APPLY || printf 'run again with --apply to remove them\n'
