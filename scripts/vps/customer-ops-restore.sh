#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'usage: customer-ops-restore.sh --repository RESTIC_REPOSITORY --password-file FILE --snapshot ID --target-empty DIR [--receipt FILE]'; }
REPOSITORY=''; PASSWORD_FILE=''; SNAPSHOT=''; TARGET=''; RECEIPT=''
while (($#)); do
  case "$1" in
    --repository) REPOSITORY="$2"; shift 2 ;;
    --password-file) PASSWORD_FILE="$2"; shift 2 ;;
    --snapshot) SNAPSHOT="$2"; shift 2 ;;
    --target-empty) TARGET="$2"; shift 2 ;;
    --receipt) RECEIPT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done
[[ -n "$REPOSITORY" && -n "$SNAPSHOT" && -f "$PASSWORD_FILE" && -n "$TARGET" ]] || { usage >&2; exit 64; }
[[ "$REPOSITORY" =~ ^(sftp|s3|rest|rclone|b2|azure|gs): ]] || { echo 'repository must be an off-host restic backend (sftp:, s3:, rest:, rclone:, b2:, azure:, or gs:)' >&2; exit 64; }
[[ -d "$TARGET" ]] || { echo 'restore target must already exist' >&2; exit 64; }
[[ -z "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'restore target is not empty; refusing to overwrite' >&2; exit 65; }
[[ "$(stat -c '%a' "$PASSWORD_FILE" 2>/dev/null || stat -f '%Lp' "$PASSWORD_FILE")" == 600 ]] || { echo 'restic password file must be mode 0600' >&2; exit 64; }
command -v restic >/dev/null || { echo 'restic is required' >&2; exit 69; }
export RESTIC_REPOSITORY="$REPOSITORY" RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
restic restore "$SNAPSHOT" --target "$TARGET"
MANIFEST="$(find "$TARGET" -name MANIFEST -type f -print -quit)"
[[ -n "$MANIFEST" ]] || { echo 'restored backup has no coverage manifest' >&2; exit 65; }
for required in postgres mariadb mautic chatwoot; do
  grep -q "$required" "$MANIFEST" || { echo "restore coverage missing: $required" >&2; exit 65; }
done
for artifact in postgres-globals.sql chatwoot.dump snagtime.dump mautic.sql mautic-config.tar mautic-media-files.tar mautic-media-images.tar chatwoot-storage.tar; do
  find "$(dirname "$MANIFEST")" -name "$artifact" -type f -print -quit | grep -q . || { echo "restore artifact missing: $artifact" >&2; exit 65; }
done
if [[ -n "$RECEIPT" ]]; then
  umask 077
  {
    echo 'blockwise customer-ops prepared restore receipt'
    date -u +%Y-%m-%dT%H:%M:%SZ
    echo "snapshot=$SNAPSHOT"
    echo 'validated: empty-target guard, coverage manifest, postgres/mariadb/mautic/chatwoot artifacts'
    echo 'status: extraction and artifact validation only; isolated import and smoke drill are still required'
  } > "$RECEIPT"
  chmod 600 "$RECEIPT"
fi
echo "restore completed into empty target: $TARGET; import into isolated services only"
