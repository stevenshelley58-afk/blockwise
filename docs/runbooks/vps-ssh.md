# VPS SSH

SSH over Tailscale is the operator path for the self-hosted product VPS and
the separate Hermes research runtime. Use key authentication with
`BatchMode=yes`; never copy a private key into the repository.

- Host: `100.78.126.112`
- Routine user: `hermes`
- Provisioning user: `root`
- Product checkout: `/projects/blockwise`
- Product env: `/srv/blockwise/product/.env`
- Product backups: `/srv/blockwise/backups/product`
- Hermes runtime: `/opt/blockwise`

    ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes hermes@100.78.126.112

From the committed release checkout (the retained working copy at the exact
serving SHA, for example `/projects/blockwise-release-6f2f92ea`; not the old
primary `/projects/blockwise` checkout, which predates the revision-aware
health script), run the rendered Compose config and status checks without
printing the env. For release evidence, run:

    export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
    scripts/vps/product-health.sh <expected-full-git-sha>

The expected full SHA checks the compiled app revision as well as readiness.
The no-argument form is readiness-only.

Product data operations use the guarded scripts in `scripts/vps/`; follow the
[production readiness](production-readiness.md), [OSS migration](oss-product-migration.md),
and [rollback](rollback.md) runbooks. Product and Hermes Compose projects,
networks, volumes, env files, backups, and migration sets stay separate.
