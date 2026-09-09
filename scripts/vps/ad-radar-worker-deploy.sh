#!/usr/bin/env bash
# Deploy the existing Ad Radar service from committed source; never copies a working tree.
set -euo pipefail
repo="$(git rev-parse --show-toplevel)"
revision="$(git rev-parse --verify "${1:?usage: ad-radar-worker-deploy.sh FULL_SHA}^{commit}")"
root=/srv/hermes/ad-db
unit=/etc/systemd/system/hermes-ad-db-worker.service

# Activate an already staged release without rebuilding or replacing it.
if [[ "${2:-}" == "--activate" ]]; then
  requested="$1"
  [[ "$requested" =~ ^[0-9a-f]{40}$ ]] || { echo "Activation requires a full 40-character SHA." >&2; exit 1; }
  revision="$(git rev-parse --verify "${requested}^{commit}")"
  test "$revision" = "$requested" || { echo "SHA is not the exact resolved commit." >&2; exit 1; }
  release="$root/releases/$revision"
  test -d "$release" || { echo "Staged release is missing: $release" >&2; exit 1; }
  test -f "$release/REVISION" && test "$(cat "$release/REVISION")" = "$revision" || { echo "Release revision marker mismatch." >&2; exit 1; }
  test -f "$release/worker.service" || { echo "Staged worker.service is missing." >&2; exit 1; }
  test -d "$release/runtime" || { echo "Staged runtime is missing." >&2; exit 1; }
  test -f "$release/runtime/bin/supabase-supervisor.mjs" || { echo "Staged supervisor runtime is missing." >&2; exit 1; }
  test -f "$unit"
  install -m 644 "$release/worker.service" "$unit"
  systemctl daemon-reload
  systemctl restart hermes-ad-db-worker.service
  sleep 3
  systemctl is-active --quiet hermes-ad-db-worker.service
  test "$(systemctl show hermes-ad-db-worker.service -p WorkingDirectory --value)" = "$release/runtime"
  printf 'Activated %s\nRollback unit retained: %s/previous.service\n' "$revision" "$release"
  exit 0
fi
release="$root/releases/$revision"
previous="$(systemctl show hermes-ad-db-worker.service -p WorkingDirectory --value)"
test -d "$previous/node_modules/sharp"
test -f "$unit"
test ! -e "$release" || { echo "Release already exists. Use its recorded unit for rollback rather than overwriting."; exit 1; }
umask 027
mkdir -p "$release"
git -C "$repo" archive "$revision" hermes/tools/research-runtime | tar -x -C "$release" --strip-components=3
mkdir "$release/runtime"
# The archive contains bin/ and src/ at its root.
mv "$release/bin" "$release/src" "$release/runtime/"
cp -a "$previous/node_modules" "$release/runtime/"
expected="$(git -C "$repo" show "$revision:package-lock.json" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).packages["node_modules/sharp"].version))')"
actual="$(node -p "require('$release/runtime/node_modules/sharp/package.json').version")"
test "$expected" = "$actual" || { echo "Sharp bundle does not match committed lockfile; release not activated."; exit 1; }
while IFS= read -r -d '' file; do node --check "$file" >/dev/null; done < <(find "$release/runtime/bin" -name '*.mjs' -print0)
printf '%s\n' "$revision" > "$release/REVISION"
cp "$unit" "$release/previous.service"
python3 - "$unit" "$release" <<'PY'
import sys
from pathlib import Path
unit,release=map(Path,sys.argv[1:])
lines=unit.read_text().splitlines()
lines=[f"WorkingDirectory={release}/runtime" if l.startswith("WorkingDirectory=")
       else f"ExecStart=/usr/bin/node {release}/runtime/bin/supabase-supervisor.mjs --ad-db-worker" if l.startswith("ExecStart=")
       else l for l in lines]
# Allow the new worker to stop claiming and drain paid requests before termination.
lines=[line for line in lines if not line.startswith("TimeoutStopSec=")]
lines.insert(lines.index("[Service]")+1, "TimeoutStopSec=300")
(release/"worker.service").write_text("\n".join(lines)+"\n")
PY
chown -R hermes:hermes "$release"
if [[ "${2:-}" == "--stage" ]]; then
  printf 'Staged %s without activating. Unit: %s/worker.service\n' "$revision" "$release"
  exit 0
fi
install -m 644 "$release/worker.service" "$unit"
systemctl daemon-reload
systemctl restart hermes-ad-db-worker.service
sleep 3
systemctl is-active --quiet hermes-ad-db-worker.service
test "$(systemctl show hermes-ad-db-worker.service -p WorkingDirectory --value)" = "$release/runtime"
printf 'Activated %s\nRollback unit retained: %s/previous.service\n' "$revision" "$release"
