# VPS SSH — Permanent Connection Runbook

**Purpose:** Connect to the Blockwise production VPS from a Cowork/Claude sandbox
session. The sandbox filesystem is wiped between sessions, so the SSH key lives
in the persistent, gitignored repo folder `.secrets/` and is re-staged into the
sandbox each session by the steps below.

## Facts

- **Host:** `76.13.209.160` (also `api.cuz.fail`, `app.cuz.fail`)
- **User:** `root`
- **Key (persistent):** `<repo>/.secrets/vps_key` (private), `<repo>/.secrets/vps_key.pub` (public)
- The key is a dedicated ed25519 keypair generated for Cowork. `.secrets/` is
  gitignored — never commit it.
- One-time setup: the public key must be present in the VPS
  `~/.ssh/authorized_keys` for root. If `ssh` returns `Permission denied
  (publickey)`, that one-time step has not been done (or was reset) — see
  "Re-enrolling the key" below.

## Connect (run every session)

The Blockwise mount path contains a per-session token, so do not hardcode it —
locate the key dynamically, stage it with correct permissions, and verify it
before use:

```bash
# 1. Find the persisted key (path varies per session)
KEY=$(find /sessions -maxdepth 6 -path '*/Blockwise/.secrets/vps_key' 2>/dev/null | head -1)
echo "key at: $KEY"

# 2. Stage into the sandbox with 600 perms (SSH refuses world-readable keys)
mkdir -p ~/.ssh
cp "$KEY" ~/.ssh/vps_key
chmod 600 ~/.ssh/vps_key

# 3. Validate the staged key is intact (catches mount read-cache corruption).
#    Should print an "ssh-ed25519 ..." line. If it errors, the cp read a stale
#    mount cache — re-stage using the Read tool to read .secrets/vps_key and
#    write the exact bytes to ~/.ssh/vps_key instead.
ssh-keygen -y -f ~/.ssh/vps_key

# 4. Connect (accept-new trusts the host key on first use, then pins it)
ssh -i ~/.ssh/vps_key -o StrictHostKeyChecking=accept-new root@76.13.209.160 'hostname; uptime'
```

Run remote commands non-interactively by appending them in single quotes, or
pipe a heredoc: `ssh -i ~/.ssh/vps_key root@76.13.209.160 'bash -s' <<'EOF' ... EOF`.

## Re-enrolling the key (only if publickey auth fails)

The public key must be in root's `authorized_keys` on the VPS. The current
public key is in `.secrets/vps_key.pub`. To install it, the operator runs ONCE
on the VPS (or via an existing access method):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'PASTE_CONTENTS_OF_vps_key.pub_HERE' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## Redeploy the Hermes daemon

After connecting, the deploy lives under `/opt/blockwise`. Confirm the active
compose file before running (the repo has historically carried conflicting
paths — `infra/coolify/docker-compose.research.yml` vs `infra/v3`), then:

```bash
cd /opt/blockwise
git pull                     # pull latest (includes the Apify self-heal commit)
ls infra/*/docker-compose*.yml infra/**/docker-compose*.yml 2>/dev/null   # find the live compose file
# Then bring the stack up with the file you confirmed, e.g.:
# docker compose -f <confirmed-compose-file> up -d --build hermes
docker compose ps
curl -fsS http://127.0.0.1:8642/health
```

The Apify paid-capture circuit self-heals on the next supervisor tick once the
daemon is running the new code (no cooldown stamp is set and month spend is far
under the cap). Remember the `apify_per_run_cap_usd` is `$0.05` in
`research.runtime_settings` — raise it (e.g. to match the `$0.25` canary cap) or
the circuit will recover then re-trip on spend-without-ingest.
