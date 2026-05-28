#!/usr/bin/env bash
# scripts/vps/bootstrap.sh
#
# One-shot bootstrap for a fresh Hostinger Ubuntu 22.04 / 24.04 VPS.
# Run as root on the VPS.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/blockwise/feature/hermes-research-engine/scripts/vps/bootstrap.sh | bash
# or copy this file across and `bash bootstrap.sh`.
#
# Idempotent — safe to re-run. Each step checks for an existing install first.

set -euo pipefail

log() { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[bootstrap-fail]\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  fail "Run as root (sudo bash $0)"
fi

# ---------------------------------------------------------------------------
# 1. Base packages
# ---------------------------------------------------------------------------
log "updating apt + installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release \
  ufw fail2ban htop tmux jq git unattended-upgrades \
  python3 python3-venv python3-pip

# ---------------------------------------------------------------------------
# 2. Firewall — only Cloudflare + SSH
# ---------------------------------------------------------------------------
log "configuring ufw firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "ssh"
# 80/443 only needed if you put Coolify directly on the public internet.
# We'll go via Cloudflare Tunnel instead; leave them off.
ufw --force enable

# ---------------------------------------------------------------------------
# 3. SSH hardening (disable password login after we confirm a key works)
# ---------------------------------------------------------------------------
log "ensuring /root/.ssh exists"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Do NOT auto-disable password auth here; operator must paste a key first.
# Once a key is in place, run:
#   sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart ssh

# ---------------------------------------------------------------------------
# 4. Docker (CE) + compose plugin
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
log "docker version: $(docker --version)"

# ---------------------------------------------------------------------------
# 5. Coolify
# ---------------------------------------------------------------------------
if [ ! -d /data/coolify ]; then
  log "installing coolify (~5 min)"
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
else
  log "coolify already installed"
fi

# ---------------------------------------------------------------------------
# 6. Cloudflare Tunnel (cloudflared)
# ---------------------------------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  log "installing cloudflared"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
fi

cat <<'NOTE'

== NEXT STEPS (manual, browser-based) ============================================

  1. Coolify is reachable at  http://<this-server-ip>:8000  for the FIRST
     login only. Create the admin account, then immediately do step 2.

  2. In the Cloudflare dashboard:
       a) Zero Trust → Networks → Tunnels → Create tunnel
          - Name: blockwise-research
          - Save the token displayed
       b) Run on this server:
            cloudflared service install <TOKEN>
            systemctl enable --now cloudflared
       c) Add public hostnames to the tunnel:
            coolify.blockwise.sale  → http://localhost:8000
            hermes.blockwise.sale   → http://localhost:8080
            aion.blockwise.sale     → http://localhost:7000
            uptime.blockwise.sale   → http://localhost:3001
       d) Zero Trust → Access → Applications → add an app for each subdomain
          with a policy of "Allow" → emails → your email only.

  3. Back in Coolify:
       a) Connect this GitHub repo (feature/hermes-research-engine).
       b) New Resource → Docker Compose →
            file path: infra/coolify/docker-compose.research.yml
       c) Paste all required env vars (see docs/research-engine/env.md).
       d) Deploy.

  4. From the Blockwise app, visit /operator/research. The status panel
     will be empty until the orchestrator's first tick completes.

==================================================================================
NOTE
