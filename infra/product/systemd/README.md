# Transactional email drain timer

These units are deployment inputs for the existing VPS systemd pattern; they are not installed by Git.
During the product deploy, install them and enable the timer after the app and migration are healthy:

    sudo install -m 0644 infra/product/systemd/blockwise-email-outbox-drain.service /etc/systemd/system/
    sudo install -m 0644 infra/product/systemd/blockwise-email-outbox-drain.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now blockwise-email-outbox-drain.timer

The timer is fail-closed when EMAIL_PROVIDER or the signed internal-auth secret is absent.
Keep /srv/blockwise/product/.env mode 0600; the script signs requests without placing the secret in process arguments.
