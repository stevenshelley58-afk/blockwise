#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/vps/product-release-preflight.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

assert_ok() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass=$((pass + 1))
    printf 'ok - %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'not ok - %s\n' "$name" >&2
  fi
}

assert_fail() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail=$((fail + 1))
    printf 'not ok - %s (unexpected pass)\n' "$name" >&2
  else
    pass=$((pass + 1))
    printf 'ok - %s\n' "$name"
  fi
}

SOURCE="$TMP/source"
RELEASES="$TMP/releases"
ENV_FILE="$TMP/product.env"
BIN="$TMP/bin"
GUARD="$TMP/product-release-preflight.sh"
mkdir -p "$RELEASES" "$BIN"
git init --quiet --initial-branch=main "$SOURCE"
git -C "$SOURCE" config user.email test@example.invalid
git -C "$SOURCE" config user.name test
printf '.ignored/\n' > "$SOURCE/.gitignore"
printf 'authority fixture\n' > "$SOURCE/fixture.txt"
git -C "$SOURCE" add .gitignore fixture.txt
git -C "$SOURCE" commit --quiet -m fixture
CANDIDATE="$(git -C "$SOURCE" rev-parse HEAD)"
WRONG_SHA=0000000000000000000000000000000000000000
git -C "$SOURCE" update-ref refs/remotes/origin/main "$CANDIDATE"
git clone --quiet --no-checkout "$SOURCE" "$RELEASES/$CANDIDATE"
git -C "$RELEASES/$CANDIDATE" checkout --quiet --detach "$CANDIDATE"

cp "$SCRIPT" "$GUARD"
sed -i \
  -e "s|^readonly PRODUCTION_SOURCE_ROOT=.*|readonly PRODUCTION_SOURCE_ROOT=$SOURCE|" \
  -e "s|^readonly PRODUCTION_RELEASE_ROOT=.*|readonly PRODUCTION_RELEASE_ROOT=$RELEASES|" \
  -e "s|^readonly PRODUCTION_ENV_FILE=.*|readonly PRODUCTION_ENV_FILE=$ENV_FILE|" \
  -e "s|^readonly PRODUCTION_APP_CONTAINER=.*|readonly PRODUCTION_APP_CONTAINER=test-app|" \
  "$GUARD"
chmod 0755 "$GUARD"

cat > "$BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
candidate="${PREFLIGHT_FAKE_SHA:?}"
selected_id="${PREFLIGHT_SELECTED_IMAGE_ID:-sha256:selected}"
case "$*" in
  *"image inspect"*"{{.Id}}"*) printf '%s' "$selected_id" ;;
  *"image inspect"*) printf '%s' "${PREFLIGHT_IMAGE_SHA:-$candidate}" ;;
  *"inspect"*"{{.Image}}"*) printf '%s' "${PREFLIGHT_CONTAINER_IMAGE_ID:-$selected_id}" ;;
  *"inspect"*) printf '%s' "${PREFLIGHT_CONTAINER_SHA:-$candidate}" ;;
  *) exit 64 ;;
esac
DOCKER
cat > "$BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
out=""
while (($#)); do
  if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi
done
printf '{"app":"%s","status":"%s","revision":"%s"}\n' "${PREFLIGHT_HEALTH_APP:-blockwise}" "${PREFLIGHT_HEALTH_STATUS:-ready}" "${PREFLIGHT_HEALTH_SHA:?}" > "$out"
CURL
chmod 0755 "$BIN/docker" "$BIN/curl"
printf 'BLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\nBLOCKWISE_PUBLIC_URL=https://example.invalid\n' "$CANDIDATE" "$CANDIDATE" > "$ENV_FILE"

run_guard() {
  PATH="$BIN:$PATH" \
  PREFLIGHT_FAKE_SHA="$CANDIDATE" \
  PREFLIGHT_HEALTH_SHA="${PREFLIGHT_HEALTH_SHA:-$CANDIDATE}" \
  PREFLIGHT_HEALTH_APP="${PREFLIGHT_HEALTH_APP:-blockwise}" \
  PREFLIGHT_HEALTH_STATUS="${PREFLIGHT_HEALTH_STATUS:-ready}" \
  PREFLIGHT_IMAGE_SHA="${PREFLIGHT_IMAGE_SHA:-$CANDIDATE}" \
  PREFLIGHT_CONTAINER_SHA="${PREFLIGHT_CONTAINER_SHA:-$CANDIDATE}" \
  PREFLIGHT_SELECTED_IMAGE_ID="${PREFLIGHT_SELECTED_IMAGE_ID:-sha256:selected}" \
  PREFLIGHT_CONTAINER_IMAGE_ID="${PREFLIGHT_CONTAINER_IMAGE_ID:-sha256:selected}" \
  "$GUARD" "$@"
}

assert_ok "accepts canonical clean detached candidate" run_guard "$CANDIDATE"
assert_ok "accepts matching image and live provenance" run_guard "$CANDIDATE" --image "blockwise-app:$CANDIDATE" --check-live
PRODUCT_RELEASE_PREFLIGHT_TEST_MODE=1 PRODUCT_RELEASE_PREFLIGHT_TEST_SOURCE_ROOT=/wrong \
  assert_ok "ignores former test-seam environment variables" run_guard "$CANDIDATE"
assert_fail "rejects a candidate that differs from canonical main" run_guard "$WRONG_SHA"

printf 'BLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\nBLOCKWISE_PUBLIC_URL=https://example.invalid\n' "$CANDIDATE" "$WRONG_SHA" > "$ENV_FILE"
assert_fail "rejects an environment SHA selector mismatch" run_guard "$CANDIDATE" --check-live
printf 'BLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\nBLOCKWISE_PUBLIC_URL=https://example.invalid\n' "$CANDIDATE" "$CANDIDATE" > "$ENV_FILE"

git -C "$SOURCE" checkout --quiet -b feature
assert_fail "rejects a source checkout off main" run_guard "$CANDIDATE"
git -C "$SOURCE" checkout --quiet main

printf 'dirty\n' >> "$SOURCE/fixture.txt"
assert_fail "rejects tracked canonical source changes" run_guard "$CANDIDATE"
git -C "$SOURCE" checkout --quiet -- fixture.txt

printf 'dirty\n' > "$RELEASES/$CANDIDATE/untracked.txt"
assert_fail "rejects an untracked release checkout file" run_guard "$CANDIDATE"
rm -f "$RELEASES/$CANDIDATE/untracked.txt"

mkdir "$RELEASES/$CANDIDATE/.ignored"
printf 'ignored\n' > "$RELEASES/$CANDIDATE/.ignored/build-output"
assert_fail "rejects an ignored release checkout file" run_guard "$CANDIDATE"
rm -rf "$RELEASES/$CANDIDATE/.ignored"

PREFLIGHT_IMAGE_SHA="$WRONG_SHA" \
  assert_fail "rejects an image with the wrong OCI revision" run_guard "$CANDIDATE" --image "blockwise-app:$CANDIDATE"

PREFLIGHT_CONTAINER_SHA="$WRONG_SHA" \
  assert_fail "rejects a running container with the wrong OCI revision" run_guard "$CANDIDATE" --check-live

PREFLIGHT_CONTAINER_IMAGE_ID=sha256:other \
  assert_fail "rejects a running container image ID mismatch" run_guard "$CANDIDATE" --check-live

PREFLIGHT_HEALTH_SHA="$WRONG_SHA" \
  assert_fail "rejects a public health revision mismatch" run_guard "$CANDIDATE" --check-live

PREFLIGHT_HEALTH_STATUS=degraded \
  assert_fail "rejects unhealthy public health despite matching revision" run_guard "$CANDIDATE" --check-live

git -C "$RELEASES/$CANDIDATE" checkout --quiet -b accidental-branch
assert_fail "rejects a non-detached release checkout" run_guard "$CANDIDATE"

printf '1..%d\n' "$((pass + fail))"
printf '# pass %d fail %d\n' "$pass" "$fail"
((fail == 0))
