#!/usr/bin/env bash
# Sole release entry. It changes only the two app selectors and product-app.
set -Eeuo pipefail
umask 077
readonly CANONICAL_SOURCE=/projects/blockwise
readonly RELEASES=/srv/blockwise/releases/product
readonly RECEIPTS=/srv/blockwise/releases/receipts
readonly ENV=/srv/blockwise/product/.env
readonly LOCK=/srv/blockwise/releases/product/.product-release.lock

# The tree a release is read from. It defaults to the canonical checkout, and
# may be pointed at an immutable release worktree (`$RELEASES/<sha>`) so an
# automated release never depends on whatever is uncommitted in the canonical
# tree. It stays a worktree of the same repository, resolved below.
SOURCE="${BLOCKWISE_RELEASE_SOURCE:-$CANONICAL_SOURCE}"

usage() {
  cat <<'USAGE'
Usage:
  product-release.sh --prepare [full-git-sha]
  product-release.sh --deploy <full-git-sha> --receipt <absolute-receipt.json>

No arguments is a non-mutating plan. Receipt JSON must be exactly:
{"sha":"<full-git-sha>","canary_pass":true,"repository_checks":"pass"}
A verified --deploy fast-forwards the canonical checkout to the released
revision, unless that checkout has uncommitted changes or is not on main.
USAGE
}
fail() { printf 'product release failed: %s\n' "$*" >&2; exit 2; }
sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]]; }
read_env() {
  local key="$1" line value
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || return 2
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=(.*)$ ]] || continue
    value="${BASH_REMATCH[1]}"
    value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then value="${value:1:${#value}-2}"; fi
    if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then value="${value:1:${#value}-2}"; fi
    printf %s "$value"; return 0
  done < "$ENV"
  return 1
}
validate_receipt() {
  local path="$1" expected="$2" real
  [[ "$path" = /* ]] || fail "receipt must be an absolute path"
  real="$(realpath -e -- "$path")" || fail "receipt is unavailable"
  [[ -f "$real" ]] || fail "receipt must be a regular file"
  python3 - "$real" "$expected" <<'PY'
import json, os, sys
path, expected = sys.argv[1:]
if os.path.getsize(path) > 65536: raise SystemExit("receipt is too large")
with open(path, "rb") as f: value = json.load(f)
if not isinstance(value, dict) or set(value) != {"sha", "canary_pass", "repository_checks"}: raise SystemExit("receipt schema is invalid")
if value["sha"] != expected or value["canary_pass"] is not True or value["repository_checks"] != "pass": raise SystemExit("receipt does not attest this candidate")
PY
}
refresh_origin_main() {
  "$GIT" -C "$SOURCE" fetch --quiet origin main
}
canonical() {
  local target="$1"
  # A release worktree is detached at the exact commit being released, so the
  # branch name is empty there. The revision checks below already pin it.
  local branch; branch="$("$GIT" -C "$SOURCE" branch --show-current)"
  [[ -z "$branch" || "$branch" == main ]] || fail "canonical source is not on main"
  [[ "$("$GIT" -C "$SOURCE" rev-parse HEAD)" == "$target" ]] || fail "canonical HEAD does not match candidate"
  "$GIT" -C "$SOURCE" diff --quiet HEAD -- || fail "canonical source has tracked changes"
}
# Preparing only needs the candidate to be the fetched main, because the release
# worktree is created from the object store and never reads the canonical
# working tree. Requiring the canonical HEAD to equal the candidate here would
# reject every prepare whose main has moved ahead of the local checkout, which
# is the normal case for an automated release.
require_candidate_is_main() {
  local target="$1"
  assert_source_authority
  "$GIT" -C "$SOURCE" cat-file -e "${target}^{commit}" 2>/dev/null || fail "candidate is not a commit in $CANONICAL_SOURCE"
  [[ "$("$GIT" -C "$SOURCE" rev-parse origin/main)" == "$target" ]] || fail "origin/main does not match candidate"
}
# The override may only name a worktree of the canonical repository, so a bad
# environment variable can never redirect a release at an unrelated checkout.
assert_source_authority() {
  readonly SOURCE
  [[ -d "$SOURCE" ]] || fail "release source is not a directory: $SOURCE"
  local common releases_real source_real
  common="$("$GIT" -C "$SOURCE" rev-parse --git-common-dir)" || fail "release source is not a git repository"
  # git reports this relative to the working directory, and a service manager
  # starts with none, so re-anchor it to the source before resolving. Without
  # this a relative answer such as ".git" becomes "/.git" and every override is
  # rejected.
  [[ "$common" = /* ]] || common="$SOURCE/$common"
  common="$(readlink -f -- "$common")"
  [[ "$common" == "$CANONICAL_SOURCE/.git" ]] || fail "release source is not a worktree of $CANONICAL_SOURCE (source: '$SOURCE', common dir: '$common')"
  if [[ "$SOURCE" != "$CANONICAL_SOURCE" ]]; then
    releases_real="$(readlink -f -- "$RELEASES")"
    source_real="$(readlink -f -- "$SOURCE")"
    [[ "$source_real" == "$releases_real"/* ]] || fail "release source override must live under $RELEASES"
  fi
}
# The canonical tree is the record of what is live, and the watcher releases
# from an immutable worktree without ever moving it. Left alone it therefore
# falls behind the moment another session pushes: every release lands on
# origin/main, and none of that reaches the branch an agent reads. Every such
# session then reports the checkout as behind, and a tree that is merely old is
# easy to mistake for one holding another session's work. Catching the branch up
# once the release is verified live is the whole fix.
advance_canonical_main() {
  local branch changed
  # None of these outcomes may fail the release: it is already verified live by
  # the time this runs, and a stale branch is not worth rolling production back
  # over. Each one says what it left behind instead.
  branch="$("$GIT" -C "$CANONICAL_SOURCE" branch --show-current)"
  if [[ "$branch" != main ]]; then
    printf 'note: canonical checkout is on %s; left where it is\n' "${branch:-no branch}" >&2
    return 0
  fi
  # The candidate is origin/main and canonical HEAD equalled the revision before
  # this one, so this only ever fast-forwards. Uncommitted changes are the one
  # case that must not be forced: they belong to a session that has not
  # committed them, and losing them is worse than a stale branch.
  changed="$("$GIT" -C "$CANONICAL_SOURCE" diff --shortstat HEAD -- 2>/dev/null)"
  if [[ -n "$changed" ]]; then
    printf 'note: canonical checkout has uncommitted changes; left at %s\n' \
      "$("$GIT" -C "$CANONICAL_SOURCE" rev-parse --short=12 HEAD)" >&2
    return 0
  fi
  if "$GIT" -C "$CANONICAL_SOURCE" merge --ff-only "$TARGET"; then
    printf 'canonical checkout advanced to %s\n' "$TARGET"
  else
    printf 'warning: canonical checkout did not advance; reconcile %s by hand\n' "$CANONICAL_SOURCE" >&2
  fi
}
checkout() {
  RELEASE="$RELEASES/$TARGET"
  mkdir -p -- "$RELEASES"
  if [[ ! -e "$RELEASE" ]]; then "$GIT" -C "$SOURCE" worktree add --detach "$RELEASE" "$TARGET"; fi
  [[ -d "$RELEASE" ]] || fail "release target is not a directory"
  [[ "$("$GIT" -C "$RELEASE" rev-parse HEAD)" == "$TARGET" ]] || fail "release checkout revision does not match candidate"
  "$GIT" -C "$RELEASE" symbolic-ref -q HEAD >/dev/null && fail "release checkout must be detached"
  [[ -z "$("$GIT" -C "$RELEASE" status --porcelain=v1 --untracked-files=all --ignored=matching)" ]] || fail "release checkout is not fully clean"
}
guard() {
  [[ -x "$PREFLIGHT" ]] || fail "release preflight is unavailable"
  BLOCKWISE_RELEASE_SOURCE="$SOURCE" "$PREFLIGHT" "$@"
}
compose() {
  local file="$1"; shift
  BLOCKWISE_GIT_SHA="$TARGET" BLOCKWISE_APP_IMAGE="$IMAGE" "$DOCKER" compose --env-file "$ENV" -f "$file" "$@"
}
write_selectors() {
  python3 - "$ENV" "$IMAGE" "$TARGET" <<'PY'
import os, re, stat, sys, tempfile
path, image, sha = sys.argv[1:]
old = os.stat(path, follow_symlinks=False)
with open(path, "rb") as f: text = f.read().decode()
for key, value in {"BLOCKWISE_APP_IMAGE": image, "BLOCKWISE_GIT_SHA": sha}.items():
    text, count = re.subn(r"^([ \t]*" + re.escape(key) + r"[ \t]*=).*$", lambda m: m.group(1)+value, text, flags=re.M)
    if count != 1: raise SystemExit("environment selector is missing or duplicated")
fd, temp = tempfile.mkstemp(prefix=".product-release.", dir=os.path.dirname(path))
try:
    os.fchmod(fd, stat.S_IMODE(old.st_mode)); os.fchown(fd, old.st_uid, old.st_gid)
    with os.fdopen(fd, "wb") as f: f.write(text.encode()); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)
    d = os.open(os.path.dirname(path), os.O_DIRECTORY)
    try: os.fsync(d)
    finally: os.close(d)
except BaseException:
    try: os.unlink(temp)
    except FileNotFoundError: pass
    raise
PY
}
restore_env() {
  python3 - "$1" "$ENV" "$2" "$3" "$4" <<'PY'
import os, stat, sys, tempfile
backup, path, mode, uid, gid = sys.argv[1:]
meta = os.stat(backup, follow_symlinks=False)
with open(backup, "rb") as f: content = f.read()
fd, temp = tempfile.mkstemp(prefix=".product-release-rollback.", dir=os.path.dirname(path))
try:
    os.fchmod(fd, int(mode, 8)); os.fchown(fd, int(uid), int(gid))
    with os.fdopen(fd, "wb") as f: f.write(content); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)
    directory_fd = os.open(os.path.dirname(path), os.O_DIRECTORY)
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)
except BaseException:
    try: os.unlink(temp)
    except FileNotFoundError: pass
    raise
PY
}
rollback() {
  local original=$? failed=0
  trap - ERR
  printf '%s\n' "product release failed after environment mutation; attempting rollback" >&2
  restore_env "$ENV_BACKUP" "$ENV_MODE" "$ENV_UID" "$ENV_GID" || { failed=1; printf '%s\n' "rollback: environment restoration failed" >&2; }
  if ((failed == 0)); then
    TARGET="$PREVIOUS_SHA"; IMAGE="$PREVIOUS_IMAGE"
    compose "$PREVIOUS_COMPOSE" up -d --wait --wait-timeout 90 --no-deps --no-build --pull never --force-recreate product-app || { failed=1; printf '%s\n' "rollback: previous app recreation failed" >&2; }
  fi
  if ((failed == 0)); then BLOCKWISE_PRODUCT_ENV_FILE="$ENV" "$PREVIOUS_RELEASE/scripts/vps/product-health.sh" "$PREVIOUS_SHA" || { failed=1; printf '%s\n' "rollback: previous health check failed" >&2; }; fi
  ((failed == 0)) && printf '%s\n' "rollback: restored previous environment and product app" >&2 || printf '%s\n' "rollback: incomplete; inspect errors before another release action" >&2
  exit "$original"
}
prepare() {
  require_candidate_is_main "$TARGET"; checkout; guard "$TARGET" --candidate-only
  local file="$RELEASE/infra/coolify/docker-compose.product.yml"
  [[ -f "$file" && -f "$ENV" ]] || fail "release compose or protected environment is unavailable"
  IMAGE="blockwise-app:$TARGET"
  if "$DOCKER" image inspect "$IMAGE" >/dev/null 2>&1; then
    guard "$TARGET" --image "$IMAGE" --candidate-only
    printf 'reused immutable product image %s for %s\n' "$IMAGE" "$TARGET"
  else
    compose "$file" build product-app
    guard "$TARGET" --image "$IMAGE" --candidate-only
    printf 'prepared immutable product image %s for %s\n' "$IMAGE" "$TARGET"
  fi
}
deploy() {
  assert_source_authority
  checkout; IMAGE="blockwise-app:$TARGET"; guard "$TARGET" --image "$IMAGE"
  [[ "$(read_env BLOCKWISE_ENABLE_PROVIDER_WRITES)" == false ]] || fail "provider writes must remain disabled"
  PREVIOUS_SHA="$(read_env BLOCKWISE_GIT_SHA)" || fail "previous revision selector is missing"
  PREVIOUS_IMAGE="$(read_env BLOCKWISE_APP_IMAGE)" || fail "previous image selector is missing"
  sha "$PREVIOUS_SHA" && [[ -n "$PREVIOUS_IMAGE" ]] || fail "previous release selectors are invalid"
  PREVIOUS_RELEASE="$RELEASES/$PREVIOUS_SHA"; PREVIOUS_COMPOSE="$PREVIOUS_RELEASE/infra/coolify/docker-compose.product.yml"
  [[ "$PREVIOUS_COMPOSE" = /* && -f "$PREVIOUS_COMPOSE" && -x "$PREVIOUS_RELEASE/scripts/vps/product-health.sh" ]] || fail "previous release rollback files are unavailable"
  [[ "$(realpath -e -- "$PREVIOUS_COMPOSE")" == "$(realpath -e -- "$RELEASES")"/* ]] || fail "previous compose is outside release storage"
  refresh_origin_main
  canonical "$TARGET"
  guard "$TARGET" --image "$IMAGE"
  local receipts stamp
  receipts="$RECEIPTS/$TARGET"; mkdir -p -- "$receipts"; chmod 700 "$receipts"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"; ENV_BACKUP="$receipts/product.env.before-$stamp"
  read -r ENV_MODE ENV_UID ENV_GID < <(stat -c '%a %u %g' "$ENV")
  cp --preserve=mode,ownership,timestamps -- "$ENV" "$ENV_BACKUP"; chmod 600 "$ENV_BACKUP"
  trap rollback ERR; write_selectors
  compose "$RELEASE/infra/coolify/docker-compose.product.yml" up -d --wait --wait-timeout 90 --no-deps --no-build --pull never --force-recreate product-app
  guard "$TARGET" --image "$IMAGE" --check-live
  BLOCKWISE_PRODUCT_ENV_FILE="$ENV" "$RELEASE/scripts/vps/product-health.sh" "$TARGET"
  trap - ERR
  # The edge cache holds the marketing HTML for a day and that HTML names
  # content-hashed chunk files, so the previous copy has to go the moment this
  # release is live. Best effort: a healthy release is not rolled back over a
  # purge, but a silent failure would serve stale markup until the TTL expires,
  # so it is reported loudly enough to find in the release log.
  "$RELEASE/scripts/vps/product-edge-purge.sh" \
    || printf 'warning: edge cache purge failed; the previous marketing HTML stays cached until its TTL expires\n' >&2
  advance_canonical_main
  printf 'deployed %s with receipt %s\n' "$TARGET" "$(basename "$RECEIPT")"
}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT=git; DOCKER=docker; PREFLIGHT="$SCRIPT_DIR/product-release-preflight.sh"
if (($# == 0)); then usage; exit 0; fi
case "$1" in --help|-h) usage; exit 0;; esac
COMMAND="$1"; shift
case "$COMMAND" in
  --prepare)
    (($# <= 1)) || fail "--prepare accepts at most one full Git SHA"
    REQUESTED_TARGET="${1:-}"
    [[ -z "$REQUESTED_TARGET" ]] || sha "$REQUESTED_TARGET" || fail "candidate must be a lowercase 40-character Git SHA"
    ;;
  --deploy)
    [[ $# -eq 3 && "$2" == --receipt ]] || fail "--deploy requires a full Git SHA and --receipt <absolute-receipt.json>"
    TARGET="$1"; RECEIPT="$3"; sha "$TARGET" || fail "candidate must be a lowercase 40-character Git SHA"
    validate_receipt "$RECEIPT" "$TARGET"
    ;;
  *) fail "unknown command: $COMMAND";;
esac
mkdir -p -- "$(dirname "$LOCK")"; exec 9>"$LOCK"; flock -x 9
refresh_origin_main
if [[ "$COMMAND" == --prepare ]]; then
  TARGET="${REQUESTED_TARGET:-$("$GIT" -C "$SOURCE" rev-parse origin/main)}"
  sha "$TARGET" || fail "origin/main did not resolve to a lowercase 40-character Git SHA"
  prepare
else
  deploy
fi
