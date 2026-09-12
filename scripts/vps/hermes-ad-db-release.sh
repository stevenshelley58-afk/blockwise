#!/usr/bin/env bash
set -euo pipefail
usage() { echo "Usage: hermes-ad-db-release.sh --plan|--prepare|--install <full-commit>" >&2; exit 2; }
fail() { echo "$" >&2; exit 1; }
clean() { git -C "$1" diff --quiet && git -C "$1" diff --cached --quiet && [[ -z "$(git -C "$1" status --porcelain --untracked-files=all)" ]] || fail "refusing dirty/untracked checkout: $1"; }
[[ $# -eq 2 ]] || usage
mode=$1; commit=$2
[[ "$mode" == --plan || "$mode" == --prepare || "$mode" == --install ]] || usage
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit must be a full 40-character SHA"
repo=/projects/blockwise; release_root=/srv/hermes/ad-db/releases/$commit; render_root=/srv/hermes/ad-db/units; unit_template=$release_root/infra/hermes/ad-db-worker.service.template; rendered_unit=$render_root/$commit.service; env_file=/srv/hermes/secrets/ad-db-worker.env; launcher=$release_root/scripts/vps/hermes-ad-db-first-fill-launcher.sh
git -C "$repo" rev-parse --verify "$commit^{commit}" >/dev/null
if [[ "$mode" == --plan ]]; then printf 'release=%s\nsource=%s\nworking_directory=%s\nrendered_unit=%s\n' "$release_root" "$commit" "$release_root/hermes/tools/research-runtime" "$rendered_unit"; exit 0; fi
[[ "$(git -C "$repo" branch --show-current)" == main ]] || fail "prepare/install requires canonical main"
clean "$repo"
git -C "$repo" merge-base --is-ancestor "$commit" main || fail "prepare/install commit must be reachable from canonical main"
if [[ -e "$release_root" ]]; then :; else install -d -o hermes -g hermes /srv/hermes/ad-db/releases; git -C "$repo" worktree add --detach "$release_root" "$commit"; chown -R hermes:hermes "$release_root"; fi
[[ "$(git -C "$release_root" rev-parse HEAD)" == "$commit" ]] || fail "release HEAD is not requested commit"
[[ -z "$(git -C "$release_root" symbolic-ref -q --short HEAD)" ]] || fail "release must be detached"
clean "$release_root"
[[ -f "$unit_template" && -x "$launcher" ]] || fail "missing immutable release inputs"
"$launcher" --preflight "$release_root" "$env_file"
install -d -o root -g root -m 0755 "$render_root"
tmp=$(mktemp "$render_root/.$commit.XXXXXX"); trap 'rm -f "$tmp"' EXIT
sed "s|@RELEASE_ROOT@|$release_root|g" "$unit_template" > "$tmp"
systemd-analyze verify "$tmp"
install -o root -g root -m 0644 "$tmp" "$rendered_unit"
if [[ "$mode" == --prepare ]]; then echo "prepared $release_root"; exit 0; fi
install -o root -g root -m 0644 "$rendered_unit" /etc/systemd/system/hermes-ad-db-worker.service
systemctl daemon-reload
systemctl enable --now hermes-ad-db-worker.service
