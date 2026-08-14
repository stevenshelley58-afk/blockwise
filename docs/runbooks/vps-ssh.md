# VPS SSH

Blockwise source and its private runtime live on Steven's VPS. Routine access
uses SSH keys over Tailscale; it must not prompt for a password.

## Connection

- Host: `100.78.126.112`
- Routine user: `hermes`
- Provisioning user: `root`
- Operator key: the operator machine's normal SSH key (currently
  `~/.ssh/id_ed25519` on Windows)
- Canonical project source: `/projects/blockwise`
- Private runtime: `/opt/blockwise`
- Persistent data: `/srv/blockwise` and named Docker volumes

Example:

```bash
ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes hermes@100.78.126.112
```

`BatchMode=yes` makes a missing key fail clearly instead of falling back to a
password prompt. Do not copy private keys into this repository or create a
project-local `.secrets` key store.

## Runtime checks

The public Blockwise application is deployed through Vercel. Only the private
Hermes/research services belong on the VPS.

```bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml config --quiet
docker compose -f infra/coolify/docker-compose.research.yml ps
curl -fsS http://127.0.0.1:8642/health
curl -fsS http://127.0.0.1:9119/health
```

If `/opt/blockwise` has not been provisioned, build it from the committed Git
revision in `/projects/blockwise`; never populate it by copying a dirty working
tree. Keep environment files, databases, logs, and generated artifacts outside
the source checkout.

## Key enrolment

The matching public key must appear once in the target user's
`~/.ssh/authorized_keys` with directory mode `700` and file mode `600`. Enrol
only the public key. Never transmit or install the private key on the VPS.
