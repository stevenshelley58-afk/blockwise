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
[[ $EUID -eq 0 ]] || { echo 'customer-ops restore must run as root' >&2; exit 77; }
command -v readlink >/dev/null || { echo 'readlink is required for restore path validation' >&2; exit 69; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required for product-mail artifact validation' >&2; exit 69; }
[[ -n "$REPOSITORY" && -n "$SNAPSHOT" && "$PASSWORD_FILE" = /* && "$TARGET" = /* && -f "$PASSWORD_FILE" && ! -L "$PASSWORD_FILE" && -d "$TARGET" && ! -L "$TARGET" ]] || { echo 'absolute regular password file and restore target directory are required' >&2; exit 64; }
[[ "$(readlink -f -- "$PASSWORD_FILE")" == "$PASSWORD_FILE" && "$(readlink -f -- "$TARGET")" == "$TARGET" ]] || { echo 'password/target path may not contain symlinks' >&2; exit 64; }
[[ "$REPOSITORY" =~ ^(sftp|s3|rest|rclone|b2|azure|gs): ]] || { echo 'repository must be an off-host restic backend (sftp:, s3:, rest:, rclone:, b2:, azure:, or gs:)' >&2; exit 64; }
[[ -d "$TARGET" ]] || { echo 'restore target must already exist' >&2; exit 64; }
[[ -z "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'restore target is not empty; refusing to overwrite' >&2; exit 65; }
if [[ -n "$RECEIPT" ]]; then
  [[ "$RECEIPT" = /* && ! -L "$RECEIPT" ]] || { echo 'restore receipt must be an absolute non-symlink path' >&2; exit 64; }
  [[ ! -e "$RECEIPT" || "$(readlink -f -- "$RECEIPT")" == "$RECEIPT" ]] || { echo 'restore receipt path may not contain symlinks' >&2; exit 64; }
fi
[[ "$(stat -c '%a' "$PASSWORD_FILE" 2>/dev/null || stat -f '%Lp' "$PASSWORD_FILE")" == 600 && "$(stat -c '%u' "$PASSWORD_FILE" 2>/dev/null || stat -f '%u' "$PASSWORD_FILE")" == 0 ]] || { echo 'restic password file must be root-owned mode 0600' >&2; exit 64; }
command -v restic >/dev/null || { echo 'restic is required' >&2; exit 69; }
export RESTIC_REPOSITORY="$REPOSITORY" RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
restic restore "$SNAPSHOT" --target "$TARGET"
MANIFEST="$(find "$TARGET" -name MANIFEST -type f ! -L -print -quit)"
[[ -n "$MANIFEST" ]] || { echo 'restored backup has no coverage manifest' >&2; exit 65; }
for required in postgres mariadb mautic chatwoot product-mail; do
  grep -q "$required" "$MANIFEST" || { echo "restore coverage missing: $required" >&2; exit 65; }
done
for artifact in postgres-globals.sql chatwoot.dump snagtime.dump mautic.sql mautic-config.tar mautic-media-files.tar mautic-media-images.tar chatwoot-storage.tar stalwart-config.tar.gz stalwart-data.tar.gz SHA256SUMS; do
  find "$(dirname "$MANIFEST")" -name "$artifact" -type f -print -quit | grep -q . || { echo "restore artifact missing: $artifact" >&2; exit 65; }
done
MAIL_ARTIFACT_DIR="$(dirname "$MANIFEST")/product-mail"
[[ -d "$MAIL_ARTIFACT_DIR" && ! -L "$MAIL_ARTIFACT_DIR" && -f "$MAIL_ARTIFACT_DIR/SHA256SUMS" && ! -L "$MAIL_ARTIFACT_DIR/SHA256SUMS" ]] || { echo 'product-mail restore artifacts are not regular files' >&2; exit 65; }
(cd "$MAIL_ARTIFACT_DIR" && sha256sum --check SHA256SUMS --status) || { echo 'product-mail artifact checksum validation failed' >&2; exit 65; }
if [[ -n "$RECEIPT" ]]; then
  umask 077
  {
    echo 'blockwise customer-ops prepared restore receipt'
    date -u +%Y-%m-%dT%H:%M:%SZ
    echo "snapshot=$SNAPSHOT"
    echo 'validated: empty-target guard, coverage manifest, postgres/mariadb/mautic/chatwoot/product-mail artifacts and Stalwart checksums'
    echo 'status: complete artifact extraction and checksum validation; isolated service import and smoke drill are still required'
  } > "$RECEIPT"
  chmod 600 "$RECEIPT"
fi
echo "restore completed into empty target: $TARGET; customer-ops and product-mail state are present; import into isolated services only"
