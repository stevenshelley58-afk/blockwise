#!/usr/bin/env bash
# Separately gated Auth-only activation after the normal app release.
set -Eeuo pipefail
umask 077
fail() { printf 'auth release failed: %s\n' "$*" >&2; exit 2; }
[[ $# == 2 && "$1" == --apply && "$2" =~ ^[a-f0-9]{40}$ ]] || fail "usage: product-auth-release.sh --apply <live-full-sha>"
target="$2"
release="/srv/blockwise/releases/product/$target"
envfile=/srv/blockwise/product/.env
container=blockwise-product-product-auth-1
[[ "$(realpath "${BASH_SOURCE[0]}")" == "$release/scripts/vps/product-auth-release.sh" ]] || fail "run the committed helper from the live immutable release"
exec 9>/srv/blockwise/releases/product/.product-release.lock
flock -x 9
BLOCKWISE_RELEASE_SOURCE="$release" "$release/scripts/vps/product-release-preflight.sh" "$target" --check-live
compose() { docker compose --env-file "$envfile" -p blockwise-product -f "$1" "${@:2}"; }
file="$release/infra/coolify/docker-compose.product.yml"
# Parse configuration privately. Never print expanded Compose or container env.
previous=$(python3 - "$file" "$envfile" "$container" <<'PY'
import json, subprocess, sys, pathlib
file, envfile, container = sys.argv[1:]
def run(args): return subprocess.check_output(args, text=True)
candidate=json.loads(run(['docker','compose','--env-file',envfile,'-p','blockwise-product','-f',file,'config','--format','json']))['services']['product-auth']
current=json.loads(run(['docker','inspect',container]))[0]
existing=dict(item.split('=',1) for item in current['Config']['Env'])
desired=candidate['environment']
image=json.loads(run(['docker','image','inspect',candidate['image']]))[0]
if image['Id'] != current['Image']: raise SystemExit('Auth image content changed; separate review required')
defaults=dict(item.split('=',1) for item in image['Config'].get('Env', []))
if candidate['image'] != current['Config']['Image']: raise SystemExit('Auth image changed; separate review required')
for key,value in desired.items():
    if not key.startswith('GOTRUE_EXTERNAL_AZURE_') and str(value) != existing.get(key):
        raise SystemExit('Non-Microsoft Auth setting changed: '+key)
for key in existing:
    if key.startswith('GOTRUE_') and key not in desired and existing[key] != defaults.get(key):
        raise SystemExit('Existing Auth setting removed: '+key)
if desired.get('GOTRUE_EXTERNAL_AZURE_ENABLED') != 'true': raise SystemExit('Microsoft must be explicitly enabled in protected config')
for key in ['CLIENT_ID','SECRET','REDIRECT_URI','URL']:
    if not desired.get('GOTRUE_EXTERNAL_AZURE_'+key): raise SystemExit('Microsoft configuration incomplete')
previous=current['Config']['Labels']['com.docker.compose.project.config_files']
path=pathlib.Path(previous).resolve()
if not path.is_relative_to('/srv/blockwise/releases/product') or not path.is_file():
    raise SystemExit('Prior committed Auth compose unavailable')
tree=path.parents[2]
if run(['git','-C',str(tree),'status','--porcelain']).strip():
    raise SystemExit('Prior Auth source is dirty')
print(path)
PY
)
rollback() {
  printf 'Auth activation failed; restoring prior committed Auth definition\n' >&2
  compose "$previous" up -d --wait --wait-timeout 90 --no-deps --no-build --pull never --force-recreate product-auth
}
trap rollback ERR
compose "$file" up -d --wait --wait-timeout 90 --no-deps --no-build --pull never --force-recreate product-auth
BLOCKWISE_RELEASE_SOURCE="$release" "$release/scripts/vps/product-release-preflight.sh" "$target" --check-live
trap - ERR
printf 'Auth activated from %s; complete an interactive Microsoft login separately\n' "$target"

