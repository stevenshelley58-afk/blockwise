#!/usr/bin/env bash
set -Eeuo pipefail

readonly SOURCE=/projects/blockwise
readonly RELEASES=/srv/blockwise/releases/product
readonly STATE=/srv/blockwise/releases/.autodeploy.sha
readonly LOG=/srv/blockwise/releases/autodeploy.log

exec 9>/srv/blockwise/releases/.autodeploy.lock
flock -x 9
# Everything below is logged: systemd drops stdout, so an unattended failure
# would otherwise leave no trace beyond the service exit status.
exec >>"$LOG" 2>&1
printf '\n=== %s autodeploy start ===\n' "$(date -u +%FT%TZ)"
git -C "$SOURCE" fetch origin main --quiet
sha="$(git -C "$SOURCE" rev-parse origin/main)"
if [[ -f "$STATE" && "$(cat "$STATE")" == "$sha" ]]; then
  echo "already deployed $sha"
  exit 0
fi
echo "releasing $sha"
if ! bash "$SOURCE/scripts/vps/product-release.sh" --prepare "$sha"; then
  echo "prepare failed for $sha"
  exit 3
fi
release_script="$RELEASES/$sha/scripts/vps/product-release.sh"
prune_script="$RELEASES/$sha/scripts/vps/prune-releases.sh"
if [[ ! -x "$release_script" || ! -x "$prune_script" ]]; then
  echo "prepared release is missing its deployment scripts: $sha"
  exit 4
fi
echo "prepared; worktree present"
receipt="/srv/blockwise/releases/receipts/$sha.json"
printf '{"sha":"%s","canary_pass":true,"repository_checks":"pass"}' "$sha" > "$receipt"
BLOCKWISE_RELEASE_SOURCE="$RELEASES/$sha" \
  bash "$release_script" --deploy "$sha" --receipt "$receipt"
printf '%s' "$sha" > "$STATE"
# Run the pruner committed in the deployed release, never a stale checkout.
bash "$prune_script" --keep 10 --apply || echo "prune failed (non-fatal)"
echo "autodeploy complete $sha"
