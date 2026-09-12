#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  hermes-ad-db-release.sh --plan <commit>
  hermes-ad-db-release.sh --prepare <commit>
  hermes-ad-db-release.sh --install <commit>
EOF
  exit 2
}

[[ $# -eq 2 ]] || usage
mode=$1
commit=$2
[[ $mode == --plan || $mode == --prepare || $mode == --install ]] || usage
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "commit must be a full 40-character SHA" >&2; exit 2; }

repo=/projects/blockwise
release_root=/srv/hermes/ad-db/releases/$commit
unit_template=$repo/infra/hermes/ad-db-worker.service.template
unit_path=/etc/systemd/system/hermes-ad-db-worker.service

git -C "$repo" rev-parse --verify "$commit^{commit}" >/dev/null
[[ -f "$unit_template" ]] || { echo "missing unit template: $unit_template" >&2; exit 1; }

if [[ $mode == --plan ]]; then
  printf 'release=%s\nsource=%s\nworking_directory=%s\nunit=%s\n' "$release_root" "$commit" "$release_root/hermes/tools/research-runtime" "$unit_path"
  exit 0
fi

if [[ $mode == --prepare || $mode == --install ]]; then
  if [[ -e "$release_root" ]]; then
    git -C "$release_root" rev-parse --verify "$commit^{commit}" >/dev/null 2>&1 || {
      echo "release path exists but is not the requested commit" >&2; exit 1;
    }
  else
    install -d -o hermes -g hermes /srv/hermes/ad-db/releases
    git -C "$repo" worktree add --detach "$release_root" "$commit"
    chown -R hermes:hermes "$release_root"
  fi
  rendered=$(mktemp)
  trap 'rm -f "$rendered"' EXIT
  sed "s|@RELEASE_ROOT@|$release_root|g" "$unit_template" > "$rendered"
  install -o root -g root -m 0644 "$rendered" "$release_root/worker.service"
  if [[ $mode == --prepare ]]; then
    echo "prepared $release_root"
    exit 0
  fi
  install -o root -g root -m 0644 "$rendered" "$unit_path"
  systemctl daemon-reload
  systemctl enable --now hermes-ad-db-worker.service
fi
