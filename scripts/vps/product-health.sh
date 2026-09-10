#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/product-common.sh"
compose_with_all_profiles ps

# A worker is deliberately not part of the foundation/canary posture. Catch a
# stale worker left running from an earlier cutover before reporting readiness.
provider_writes="$(read_env_value BLOCKWISE_ENABLE_PROVIDER_WRITES || true)"
if [[ "$provider_writes" != "true" ]] && compose_with_all_profiles ps --status running --services | grep -Fxq product-worker; then
  echo "product-worker is running while BLOCKWISE_ENABLE_PROVIDER_WRITES is not true" >&2
  exit 2
fi

PUBLIC_URL="${BLOCKWISE_PUBLIC_URL:-}"
if [[ -z "$PUBLIC_URL" ]]; then
  PUBLIC_URL="$(read_env_value BLOCKWISE_PUBLIC_URL || true)"
fi
PUBLIC_URL="${PUBLIC_URL%/}"
[[ "$PUBLIC_URL" =~ ^(https?)://([^/:]+)(:([0-9]+))?$ ]] || {
  echo "BLOCKWISE_PUBLIC_URL must be an absolute http(s) origin without a path" >&2
  exit 2
}
scheme="${BASH_REMATCH[1]}"
host="${BASH_REMATCH[2]}"
port="${BASH_REMATCH[4]:-}"
if [[ "$scheme" == https ]]; then
  port="${port:-443}"
else
  port="${port:-80}"
fi
# Resolve the public hostname to the shared local edge. This checks the
# configured hostname and certificate/SNI without bypassing Frank's edge.
curl_args=(--fail --silent --show-error --max-time 10 --resolve "$host:$port:127.0.0.1")
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT
if ! curl "${curl_args[@]}" --header 'Accept: application/json' "$PUBLIC_URL/api/health" -o "$response_file"; then
  echo "product readiness request failed: $PUBLIC_URL/api/health" >&2
  exit 1
fi
# Optionally prove the intended compiled release, not just any healthy app.
expected_revision="${1:-${BLOCKWISE_EXPECTED_REVISION:-}}"
python3 - "$response_file" "$expected_revision" <<'PY'
import json
import re
import sys

with open(sys.argv[1]) as response:
    health = json.load(response)
if health.get("app") != "blockwise" or health.get("status") != "ready":
    raise SystemExit("product readiness JSON did not report Blockwise status=ready")
expected = sys.argv[2]
if expected:
    if not re.fullmatch(r"[a-f0-9]{40}", expected):
        raise SystemExit("Expected revision must be a full lowercase Git SHA")
    if health.get("revision") != expected:
        raise SystemExit(f"Release mismatch: expected {expected}, served {health.get('revision')}")
    print(f"product readiness endpoint: ready, verified release {expected}")
else:
    print("product readiness endpoint: ready (release not asserted)")
PY
