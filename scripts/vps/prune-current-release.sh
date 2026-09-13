#!/usr/bin/env bash
set -Eeuo pipefail

readonly STATE=/srv/blockwise/releases/.autodeploy.sha
readonly RELEASES=/srv/blockwise/releases/product
readonly SHA_RE='^[a-f0-9]{40}$'

if [[ ! -s "$STATE" ]]; then
  echo "missing deployed release selector: $STATE" >&2
  exit 1
fi
sha="$(cat "$STATE")"
if [[ ! "$sha" =~ $SHA_RE ]]; then
  echo "invalid deployed release selector: $sha" >&2
  exit 1
fi
script="$RELEASES/$sha/scripts/vps/prune-releases.sh"
if [[ ! -x "$script" ]]; then
  echo "missing deployed release pruner: $script" >&2
  exit 1
fi

# The selected release is protected by prune-releases.sh, so the implementation
# executing this cleanup cannot remove its own source directory.
exec "$script" "$@"
