#!/usr/bin/env bash
# The canonical checkout is the branch agents read. A verified deploy must leave
# it on the released revision, because the watcher releases from an immutable
# worktree and never moves that branch itself. This drives a real repository:
# the mocked git in product-release.test.sh can only show that a command was
# asked for, never that the branch actually moved.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${1:-$ROOT/scripts/vps/product-release.sh}"
WORK="$(mktemp -d)"
# BLOCKWISE_KEEP_TEST_WORK=1 keeps the scratch tree for inspection after a
# failure. It prints the path instead of removing it.
if [[ -n "${BLOCKWISE_KEEP_TEST_WORK:-}" ]]; then
  trap 'printf "test work left at %s\n" "$WORK"' EXIT
else
  trap 'rm -rf "$WORK"' EXIT
fi
A=1111111111111111111111111111111111111111

# Every constant the script reads is redirected into $WORK, so nothing here can
# touch the real release storage or the real canonical checkout. SOURCE is left
# alone: it captures CANONICAL_SOURCE when it is assigned, so rewriting
# CANONICAL_SOURCE already redirects it, and the release worktree is passed as
# the source override exactly as the watcher passes it.
patch() {
  sed -i \
    -e "s|^readonly CANONICAL_SOURCE=.*|readonly CANONICAL_SOURCE=$WORK/canonical|" \
    -e "s|^readonly RELEASES=.*|readonly RELEASES=$WORK/releases|" \
    -e "s|^readonly RECEIPTS=.*|readonly RECEIPTS=$WORK/receipts|" \
    -e "s|^readonly ENV=.*|readonly ENV=$WORK/product.env|" \
    -e "s|^readonly LOCK=.*|readonly LOCK=$WORK/release.lock|" \
    "$WORK/product-release.sh"
}
mkdir -p "$WORK/bin" "$WORK/receipts"
cp "$SCRIPT" "$WORK/product-release.sh"; patch
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/product-release-preflight.sh"
chmod 700 "$WORK/product-release-preflight.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/docker"
chmod 700 "$WORK/bin/docker"
env_file() { printf 'BLOCKWISE_ENABLE_PROVIDER_WRITES=false\nBLOCKWISE_APP_IMAGE=blockwise-app:%s\nBLOCKWISE_GIT_SHA=%s\n' "$1" "$1" > "$WORK/product.env"; chmod 640 "$WORK/product.env"; }
# The watcher releases through this override, which also pins the test to one
# tree: every release worktree lives in $WORK, so the fetch stays inside $WORK.
run() { PATH="$WORK/bin:$PATH" BLOCKWISE_RELEASE_SOURCE="$WORK/releases/$PUSHED" "$WORK/product-release.sh" "$@"; }
# The script resolves RELEASE from RELEASES and TARGET, and refuses a candidate
# that is not origin/main, so the candidate is labelled by moving the ref alone.
label() { git -C "$WORK/canonical" update-ref refs/remotes/origin/main "$1"; }

git init -q --initial-branch=main "$WORK/canonical"
git -C "$WORK/canonical" config user.email t@example.invalid
git -C "$WORK/canonical" config user.name t
# Every fetch goes through this remote. Its main is never read: the candidate is
# labelled on the canonical repository below, and an empty remote would make the
# fetch itself fail before any of that matters.
git init -q --bare "$WORK/origin"
git -C "$WORK/canonical" remote add origin "$WORK/origin"
# Every file a release reads is tracked in the real repository, so the fixture
# tracks its own stand-ins for them. Without these the deploy stops at the
# rollback-files check or at the health check, and neither is what this tests.
mkdir -p "$WORK/canonical/infra/coolify" "$WORK/canonical/scripts/vps"
printf 'services: {}\n' > "$WORK/canonical/infra/coolify/docker-compose.product.yml"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/canonical/scripts/vps/product-health.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/canonical/scripts/vps/product-edge-purge.sh"
chmod 700 "$WORK/canonical/scripts/vps/product-health.sh" "$WORK/canonical/scripts/vps/product-edge-purge.sh"
printf 'one\n' > "$WORK/canonical/file.txt"
git -C "$WORK/canonical" add -A
git -C "$WORK/canonical" commit -qm one
git -C "$WORK/canonical" push -q origin main
CANONICAL_ONE="$(git -C "$WORK/canonical" rev-parse HEAD)"
printf 'two\n' > "$WORK/canonical/file.txt"
git -C "$WORK/canonical" commit -qam two
# The revision another session pushed while this checkout stayed where it was.
# An epoch date is used because a formatted one makes git warn on stderr about
# ambiguity, and the warnings below capture stdout from these same commands.
git -C "$WORK/canonical" checkout -q -B pushed "$CANONICAL_ONE"
printf 'three\n' > "$WORK/canonical/file.txt"
git -C "$WORK/canonical" commit -qam "pushed by another session" --date="@1893456000 +0000"
PUSHED="$(git -C "$WORK/canonical" rev-parse HEAD)"
git -C "$WORK/canonical" checkout -q -B main "$CANONICAL_ONE"
git -C "$WORK/canonical" branch -qD pushed
git -C "$WORK/canonical" update-ref -d refs/remotes/origin/main
git -C "$WORK/canonical" worktree add -q --detach "$WORK/releases/$PUSHED" "$PUSHED"
# A deploy refuses to run unless the release it replaces still has its compose
# file and health script, so the fixture's first revision is laid out as a real
# release as well. Both are worktrees, which is also what keeps them clean: a
# file written into a release directory after checkout fails that same check.
git -C "$WORK/canonical" worktree add -q --detach "$WORK/releases/$CANONICAL_ONE" "$CANONICAL_ONE"
printf '{"sha":"%s","canary_pass":true,"repository_checks":"pass"}\n' "$PUSHED" > "$WORK/receipt.json"
label "$PUSHED"
env_file "$CANONICAL_ONE"

# A verified deploy moves the branch onto the revision it just made live.
run --deploy "$PUSHED" --receipt "$WORK/receipt.json" >/dev/null
[[ "$(git -C "$WORK/canonical" rev-parse HEAD)" == "$PUSHED" ]] || { echo "deploy did not advance the canonical checkout" >&2; exit 1; }
[[ "$(git -C "$WORK/canonical" rev-parse --abbrev-ref HEAD)" == main ]] || { echo "canonical checkout left main" >&2; exit 1; }
grep -Fx three "$WORK/canonical/file.txt" >/dev/null || { echo "canonical working tree did not follow the branch" >&2; exit 1; }

# Uncommitted work in that checkout is never forced over, and never fails a
# release that is already live.
printf 'another session was editing this\n' > "$WORK/canonical/file.txt"
env_file "$CANONICAL_ONE"
git -C "$WORK/canonical" update-ref refs/heads/main "$CANONICAL_ONE"
run --deploy "$PUSHED" --receipt "$WORK/receipt.json" >/dev/null 2>"$WORK/dirty.err"
grep -F 'uncommitted changes' "$WORK/dirty.err" >/dev/null || { echo "dirty checkout was not reported" >&2; exit 1; }
[[ "$(git -C "$WORK/canonical" rev-parse HEAD)" == "$CANONICAL_ONE" ]] || { echo "a dirty checkout was advanced anyway" >&2; exit 1; }
grep -Fx 'another session was editing this' "$WORK/canonical/file.txt" >/dev/null || { echo "uncommitted work was overwritten" >&2; exit 1; }

# A detached canonical checkout is reported and skipped rather than moved.
git -C "$WORK/canonical" checkout -q --detach "$PUSHED"
git -C "$WORK/canonical" checkout -q -- . 2>/dev/null || true
env_file "$CANONICAL_ONE"
run --deploy "$PUSHED" --receipt "$WORK/receipt.json" >/dev/null 2>"$WORK/detached.err"
grep -F 'left where it is' "$WORK/detached.err" >/dev/null || { echo "detached checkout was not reported" >&2; exit 1; }
[[ "$(git -C "$WORK/canonical" rev-parse --abbrev-ref HEAD)" == HEAD ]] || { echo "detached checkout was moved onto a branch" >&2; exit 1; }

echo "product-release canonical checkout advance tests passed"
