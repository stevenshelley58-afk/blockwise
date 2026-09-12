#!/usr/bin/env bash
# Invalidates the edge-cached marketing HTML after a release.
#
# The cache rule holds those five pages for a day, which is only safe because a
# release purges them: the prerendered HTML names content-hashed
# `/_next/static/chunks/*` files, and the old hashes stop existing the moment the
# new release is live. Skipping this would serve markup whose CSS and JS 404.
#
# Reads its token from $CF_CACHE_ENV (default /srv/blockwise/cf-cache.env, mode
# 600, outside the repository). With no token file the script is a no-op, so a
# checkout without the credential still releases.
set -Eeuo pipefail
umask 077

readonly ENV_FILE="${CF_CACHE_ENV:-/srv/blockwise/cf-cache.env}"
readonly ZONE_NAME="${CF_CACHE_ZONE:-blockwise.sale}"
readonly PATHS=(/ /pricing /privacy /terms /data-deletion)

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'edge purge: %s is absent, skipping\n' "$ENV_FILE" >&2
  exit 0
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${CLOUDFLARE_API_TOKEN:?edge purge: CLOUDFLARE_API_TOKEN missing from $ENV_FILE}"

zone_id="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin).get("result") or []; print(rows[0]["id"] if rows else "")')"
[[ -n "$zone_id" ]] || { printf 'edge purge: zone %s is not visible to the token\n' "$ZONE_NAME" >&2; exit 1; }

payload="$(python3 - "$ZONE_NAME" "${PATHS[@]}" <<'PY'
import json, sys
zone = sys.argv[1]
# The bare origin as well as `/`, because a request for the apex is cached under
# the URL the client asked for.
urls = [f"https://{zone}{path}" for path in sys.argv[2:]]
urls.append(f"https://{zone}")
print(json.dumps({"files": urls}))
PY
)"

curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$payload" \
  | python3 -c '
import json, sys
body = json.load(sys.stdin)
if not body.get("success"):
    print("edge purge: rejected:", [e.get("message") for e in body.get("errors", [])], file=sys.stderr)
    raise SystemExit(1)
# Cloudflare answers a file purge with just the zone id, so success is the only
# signal available; the caller verifies behaviourally with the check tool.
print("edge purge: accepted for zone", (body.get("result") or {}).get("id", "?"))
'
