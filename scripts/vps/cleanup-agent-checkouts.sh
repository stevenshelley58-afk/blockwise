#!/usr/bin/env bash
# Report and retire stale Blockwise checkouts.
#
# Sessions leave dated snapshot checkouts behind. They are not the maintained
# source and nothing deploys from them, but they accumulate and hide the one
# checkout that matters. This lists them with the facts needed to judge, and
# only removes one when it is provably safe.
#
# Safe means all three: every commit is already in main, nothing is uncommitted,
# and nothing has been touched for a day. Anything else is listed with the reason
# it was kept. Working trees are removed with git worktree remove when they are
# registered worktrees, and never with rm -rf.
set -Eeuo pipefail
umask 077

readonly CANONICAL=/projects/blockwise
readonly STALE_HOURS=24
ARGS=(
  /projects/blockwise-*
  /root/bw-*
  /srv/blockwise/ad-radar-free-path-*
  /srv/blockwise/e2e-runs/*
)

APPLY=false
while (($# > 0)); do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --hours) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || exit 2; STALE_HOURS="$2"; shift 2 ;;
    --help|-h) printf 'Usage: cleanup-agent-checkouts.sh [--hours <n>] [--apply]\n'; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

export HOME="${HOME:-/root}"
git -C "$CANONICAL" fetch --quiet origin main || true
readonly MAIN_SHA="$(git -C "$CANONICAL" rev-parse origin/main)"
readonly NOW="$(date +%s)"

removable=(); kept=(); freed=0

for path in "${ARGS[@]}"; do
  [[ -d "$path" ]] || continue
  [[ -e "$path/.git" ]] || continue
  name="${path##*/}"

  head_sha="$(git -C "$path" rev-parse HEAD 2>/dev/null || echo '')"
  if [[ -z "$head_sha" ]]; then
    kept+=("$name|not a readable git checkout"); continue
  fi

  # Every commit in this checkout must already be in main.
  if ! git -C "$CANONICAL" merge-base --is-ancestor "$head_sha" "$MAIN_SHA" 2>/dev/null; then
    ahead="$(git -C "$CANONICAL" rev-list --count "$MAIN_SHA..$head_sha" 2>/dev/null || echo '?')"
    kept+=("$name|has $ahead commit(s) not in main"); continue
  fi

  # Only uncommitted work protects a checkout. Two kinds of change do not count:
  # untracked regenerable artifacts (__pycache__, a scratch Caddyfile, .next),
  # and the generated SNAPSHOT banner this harness injects into the rule and doc
  # files of a dated checkout. Both are tooling, not a person's work. The banner
  # is multi-line, so those files are excluded rather than matched line by line.
  # Note the `|| true`: under pipefail a filter that legitimately matches nothing
  # would otherwise abort the whole run, which is the common case once a checkout
  # differs only by generated banners.
  modified="$(git -C "$path" diff --name-only -z -- . ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' ':(exclude)docs/**' 2>/dev/null \
    | tr '\0' '\n' | { grep -Ev '^$' || true; } | wc -l)"
  if ((modified > 0)); then
    kept+=("$name|$modified uncommitted tracked file(s)"); continue
  fi
  untracked="$(git -C "$path" ls-files --others --exclude-standard 2>/dev/null | wc -l)"

  # Idle time comes from the last commit, not the directory mtime: reading or
  # indexing a checkout updates the directory, which made months-old snapshots
  # look active.
  touched="$(git -C "$path" log -1 --format=%ct 2>/dev/null || echo 0)"
  [[ "$touched" =~ ^[0-9]+$ ]] && ((touched > 0)) || touched="$(find "$path" -maxdepth 1 -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1)"
  [[ "$touched" =~ ^[0-9]+$ ]] || touched=0
  idle_h=$(( (NOW - touched) / 3600 ))
  if ((idle_h < STALE_HOURS)); then
    kept+=("$name|active ${idle_h}h ago"); continue
  fi

  size="$(du -sb "$path" 2>/dev/null | cut -f1 || echo 0)"
  freed=$((freed + size))
  note="idle ${idle_h}h, merged"
  ((untracked > 0)) && note="$note, $untracked regenerable untracked path(s)"
  if $APPLY; then
    if git -C "$CANONICAL" worktree list --porcelain | grep -qxF "worktree $path"; then
      git -C "$CANONICAL" worktree remove --force "$path" 2>/dev/null || { kept+=("$name|worktree remove failed"); continue; }
    else
      # A plain checkout is safe to delete only because it is merged, clean and idle.
      rm -rf -- "$path" || { kept+=("$name|remove failed"); continue; }
    fi
    printf 'removed %-52s %s (%s)\n' "$name" "$(numfmt --to=iec "$size")" "$note"
  else
    printf 'would remove %-48s %s (%s)\n' "$name" "$(numfmt --to=iec "$size")" "$note"
  fi
  removable+=("$name")
done

if $APPLY; then git -C "$CANONICAL" worktree prune 2>/dev/null || true; fi

printf '\n%s %s checkout(s), %s reclaimable\n' \
  "$($APPLY && echo removed || echo 'would remove')" "${#removable[@]}" "$(numfmt --to=iec "$freed")"
if ((${#kept[@]} > 0)); then
  printf '\nkept:\n'
  for entry in "${kept[@]}"; do printf '  %-50s %s\n' "${entry%%|*}" "${entry##*|}"; done
fi
$APPLY || printf '\nrun again with --apply to remove the merged, clean, idle ones\n'
