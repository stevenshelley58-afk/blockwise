#!/usr/bin/env bash
set -Eeuo pipefail
root="${1:-}"
days="${2:-}"
[[ "$root" == /* && -d "$root" ]] || { echo "invalid retention root" >&2; exit 2; }
[[ "$days" =~ ^[1-9][0-9]*$ ]] || { echo "invalid retention days" >&2; exit 2; }
deleted=0
while IFS= read -r -d "" old; do
  rm -rf -- "$old"
  deleted=$((deleted + 1))
done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -name "20?????????????Z" -mtime +"$days" -print0)
printf "%s" "$deleted"
