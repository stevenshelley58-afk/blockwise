#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SOURCE=/projects/blockwise
readonly INSTALL_ROOT=/srv/blockwise/location-projection
readonly RELEASE_ROOT=$INSTALL_ROOT/releases
readonly CURRENT=$INSTALL_ROOT/current
readonly SOURCE_ENV=/srv/hermes/secrets/ad-db-worker.env
readonly PROJECTION_ENV=/srv/hermes/secrets/email-location-projection.env
readonly SERVICE=blockwise-research-email-location-projection.service
readonly TIMER=blockwise-research-email-location-projection.timer

fail() { printf 'email location projection install failed: %s\n' "$*" >&2; exit 2; }
usage() { printf 'Usage: %s <full-origin-main-sha> [--activate]\n' "${0##*/}"; }

[[ "$EUID" -eq 0 ]] || fail "run as root"
[[ $# -ge 1 && $# -le 2 ]] || { usage >&2; exit 2; }
readonly TARGET="$1"
readonly MODE="${2:-}"
[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || fail "target must be a lowercase 40-character Git SHA"
[[ -z "$MODE" || "$MODE" == --activate ]] || fail "unknown option: $MODE"
[[ -f "$SOURCE_ENV" ]] || fail "Hermes source environment is unavailable"

git -C "$SOURCE" fetch --quiet origin main
[[ "$(git -C "$SOURCE" rev-parse origin/main)" == "$TARGET" ]] || fail "target is not current origin/main"
git -C "$SOURCE" cat-file -e "$TARGET^{commit}" 2>/dev/null || fail "target commit is unavailable"

readonly RELEASE="$RELEASE_ROOT/$TARGET"
install -d -o root -g root -m 0755 "$INSTALL_ROOT" "$RELEASE_ROOT"
if [[ -e "$RELEASE" ]]; then
  [[ -d "$RELEASE" ]] || fail "release target is not a directory"
  [[ "$(git -C "$RELEASE" rev-parse HEAD)" == "$TARGET" ]] || fail "existing release has a different revision"
else
  (umask 022; git -C "$SOURCE" worktree add --detach "$RELEASE" "$TARGET")
fi
[[ -z "$(git -C "$RELEASE" status --porcelain=v1 --untracked-files=all --ignored=matching)" ]] || fail "release worktree is not clean"
[[ -f "$RELEASE/supabase/migrations/20260914020100_atomic_research_email_location_projection_snapshot.sql" ]] || fail "atomic projection migration is absent"
[[ -f "$RELEASE/hermes/tools/research-runtime/bin/research-email-location-projection-sync.mjs" ]] || fail "projection CLI is absent"
runuser -u hermes -- test -r "$RELEASE/hermes/tools/research-runtime/bin/research-email-location-projection-sync.mjs" || fail "Hermes cannot read the projection CLI"
runuser -u hermes -- /usr/bin/node --check "$RELEASE/hermes/tools/research-runtime/bin/research-email-location-projection-sync.mjs" || fail "projection CLI validation failed"

python3 - "$SOURCE_ENV" "$PROJECTION_ENV" <<'PY'
import grp
import os
import pwd
import stat
import sys
import tempfile

source, target = sys.argv[1:]
allowed = {
    "HERMES_SUPABASE_URL",
    "HERMES_SUPABASE_SECRET_KEY",
    "HERMES_SUPABASE_SERVICE_ROLE_KEY",
    "HERMES_CUSTOMER_SUPABASE_URL",
    "HERMES_CUSTOMER_SUPABASE_SECRET_KEY",
    "HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY",
}
values = {}
with open(source, "r", encoding="utf-8") as handle:
    for raw_line in handle:
        line = raw_line.rstrip("\r\n")
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key in allowed:
            if key in values:
                raise SystemExit(f"duplicate environment key: {key}")
            values[key] = line
if "HERMES_SUPABASE_URL" not in values:
    raise SystemExit("research URL is missing")
if not ({"HERMES_SUPABASE_SECRET_KEY", "HERMES_SUPABASE_SERVICE_ROLE_KEY"} & values.keys()):
    raise SystemExit("research service credential is missing")
if "HERMES_CUSTOMER_SUPABASE_URL" not in values:
    raise SystemExit("customer URL is missing")
if not ({"HERMES_CUSTOMER_SUPABASE_SECRET_KEY", "HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY"} & values.keys()):
    raise SystemExit("customer service credential is missing")

directory = os.path.dirname(target)
os.makedirs(directory, mode=0o700, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=".email-location-projection.", dir=directory)
try:
    os.fchmod(fd, 0o600)
    os.fchown(fd, pwd.getpwnam("hermes").pw_uid, grp.getgrnam("hermes").gr_gid)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for key in sorted(values):
            handle.write(values[key] + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
    directory_fd = os.open(directory, os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
mode = stat.S_IMODE(os.stat(target, follow_symlinks=False).st_mode)
if mode != 0o600:
    raise SystemExit("projection environment mode is not 0600")
PY

if [[ -z "$MODE" ]]; then
  printf 'prepared immutable email location projection release %s; not activated\n' "$TARGET"
  exit 0
fi

install -o root -g root -m 0644 "$RELEASE/infra/product/systemd/$SERVICE" "/etc/systemd/system/$SERVICE"
install -o root -g root -m 0644 "$RELEASE/infra/product/systemd/$TIMER" "/etc/systemd/system/$TIMER"
readonly NEXT_LINK="/srv/blockwise/location-projection/.current-$TARGET"
rm -f -- "$NEXT_LINK"
ln -s -- "$RELEASE" "$NEXT_LINK"
mv -Tf -- "$NEXT_LINK" "$CURRENT"
systemctl daemon-reload
systemctl start "$SERVICE"
[[ "$(systemctl show "$SERVICE" --property=Result --value)" == success ]] || fail "initial projection run failed"
systemctl enable --now "$TIMER"
printf 'activated immutable email location projection release %s\n' "$TARGET"
