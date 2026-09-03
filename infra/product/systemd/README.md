# Transactional email drain timer

These units are deployment inputs for the existing VPS systemd pattern; they are not installed by Git.
Install the script root-owned outside the writable checkout, then install and enable the timer after the app and migration are healthy:

    sudo install -o root -g root -m 0755 scripts/vps/email-outbox-drain.sh /usr/local/libexec/blockwise-email-outbox-drain
    sudo install -o root -g root -m 0644 infra/product/systemd/blockwise-email-outbox-drain.service /etc/systemd/system/
    sudo install -o root -g root -m 0644 infra/product/systemd/blockwise-email-outbox-drain.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now blockwise-email-outbox-drain.timer

The service runs as unprivileged hermes and loads the root-readable deployment environment before dropping privileges.
Keep /srv/blockwise/product/.env owned by root with mode 0600 so only systemd can read the secrets.
The timer is fail-closed when EMAIL_PROVIDER or the signed internal-auth secret is absent.
The signer never puts the secret in process arguments.
