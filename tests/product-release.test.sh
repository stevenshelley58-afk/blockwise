#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${1:-$ROOT/scripts/vps/product-release.sh}"
SHA=0123456789abcdef0123456789abcdef01234567
OLD=abcdef0123456789abcdef0123456789abcdef01
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ok() { "$@" >/dev/null; }
bad() { if "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; }

ok "$SCRIPT"
ok "$SCRIPT" --help
bad "$SCRIPT" --prepare not-a-sha
bad "$SCRIPT" --deploy "$SHA"
bad "$SCRIPT" --deploy "$SHA" --receipt relative.json
printf '{"sha":"%s","canary_pass":false,"repository_checks":"pass"}\n' "$SHA" > "$WORK/canary.json"
printf '{"sha":"%s","canary_pass":true,"repository_checks":"failed"}\n' "$SHA" > "$WORK/checks.json"
printf '{"sha":"wrong","canary_pass":true,"repository_checks":"pass"}\n' > "$WORK/sha.json"
printf '{"sha":"%s","canary_pass":true,"repository_checks":"pass","extra":true}\n' "$SHA" > "$WORK/extra.json"
for receipt in "$WORK"/*.json; do bad "$SCRIPT" --deploy "$SHA" --receipt "$receipt"; done

mkdir -p "$WORK/bin" "$WORK/source" "$WORK/releases/$OLD/infra/coolify" "$WORK/releases/$OLD/scripts/vps" "$WORK/receipts"
cp "$SCRIPT" "$WORK/product-release.sh"
sed -i \
  -e "s|^readonly SOURCE=.*|readonly SOURCE=$WORK/source|" \
  -e "s|^readonly RELEASES=.*|readonly RELEASES=$WORK/releases|" \
  -e "s|^readonly RECEIPTS=.*|readonly RECEIPTS=$WORK/receipts|" \
  -e "s|^readonly ENV=.*|readonly ENV=$WORK/product.env|" \
  -e "s|^readonly LOCK=.*|readonly LOCK=$WORK/release.lock|" \
  "$WORK/product-release.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/product-release-preflight.sh"
chmod 700 "$WORK/product-release-preflight.sh"
printf 'BLOCKWISE_ENABLE_PROVIDER_WRITES=false\nBLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\n' "$OLD" "$OLD" > "$WORK/product.env"
chmod 640 "$WORK/product.env"
: > "$WORK/releases/$OLD/infra/coolify/docker-compose.product.yml"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/releases/$OLD/scripts/vps/product-health.sh"
chmod 700 "$WORK/releases/$OLD/scripts/vps/product-health.sh"
cat > "$WORK/bin/git" <<'GIT'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_ROOT/git.log"
args=("$@")
joined=" $* "
case "$joined" in
  *" fetch "*) exit 0 ;;
  *" branch --show-current"*) printf 'main\n' ;;
  *" rev-parse HEAD"*|*" rev-parse origin/main"*) printf '%s\n' "$MOCK_SHA" ;;
  *" diff --quiet"*) exit 0 ;;
  *" symbolic-ref -q HEAD"*) exit 1 ;;
  *" status --porcelain"*) exit 0 ;;
  *" worktree add "*)
    for ((i=0;i<${#args[@]};i++)); do
      if [[ "${args[i]}" == --detach ]]; then release="${args[i+1]}"; break; fi
    done
    mkdir -p "$release/infra/coolify" "$release/scripts/vps"
    : > "$release/infra/coolify/docker-compose.product.yml"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$release/scripts/vps/product-health.sh"
    chmod 700 "$release/scripts/vps/product-health.sh"
    ;;
  *) echo "unexpected git invocation" >&2; exit 1 ;;
esac
GIT
cat > "$WORK/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_ROOT/docker.log"
if [[ -n "${MOCK_DOCKER_FAIL_ONCE:-}" && -e "$MOCK_DOCKER_FAIL_ONCE" && " $* " == *" up "* ]]; then
  rm -f "$MOCK_DOCKER_FAIL_ONCE"
  exit 1
fi
DOCKER
chmod 700 "$WORK/bin/git" "$WORK/bin/docker"
run() { PATH="$WORK/bin:$PATH" MOCK_ROOT="$WORK" MOCK_SHA="$SHA" "$WORK/product-release.sh" "$@"; }
printf '{"sha":"%s","canary_pass":true,"repository_checks":"pass"}\n' "$SHA" > "$WORK/ok.json"
run --prepare "$SHA"
run --deploy "$SHA" --receipt "$WORK/ok.json"
grep -Fx "BLOCKWISE_APP_IMAGE=blockwise-app:$SHA" "$WORK/product.env" >/dev/null
grep -Fx "BLOCKWISE_GIT_SHA=$SHA" "$WORK/product.env" >/dev/null
[[ "$(stat -c %a "$WORK/product.env")" == 640 ]]
[[ -d "$WORK/receipts/$SHA" ]]
[[ ! -e "$WORK/releases/$SHA/release-receipts" ]]
grep -F -- '--wait --wait-timeout 90' "$WORK/docker.log" >/dev/null
grep -F -- 'fetch --quiet origin main' "$WORK/git.log" >/dev/null

printf 'BLOCKWISE_ENABLE_PROVIDER_WRITES=false\nBLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\n' "$OLD" "$OLD" > "$WORK/product.env"
chmod 640 "$WORK/product.env"
touch "$WORK/fail-once"
MOCK_DOCKER_FAIL_ONCE="$WORK/fail-once" run --deploy "$SHA" --receipt "$WORK/ok.json" >/dev/null 2>&1 && { echo "expected rollback path to fail deployment" >&2; exit 1; }
grep -Fx "BLOCKWISE_APP_IMAGE=blockwise-app:$OLD" "$WORK/product.env" >/dev/null
grep -Fx "BLOCKWISE_GIT_SHA=$OLD" "$WORK/product.env" >/dev/null
[[ "$(stat -c %a "$WORK/product.env")" == 640 ]]
echo "product-release argument, receipt, synthetic prepare/deploy, and rollback tests passed"
