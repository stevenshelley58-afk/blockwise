# VPS access

Read the shared access bootstrap and engineering rules before connecting.
From Steven's laptop use ssh vps. Cloud sessions use the client's Tailscale
bootstrap. Do not invent a different key or change ingress for access.

## Product locations

- Canonical repository: /projects/blockwise.
- Protected configuration: /srv/blockwise/product/.env.
- Product backups: /srv/blockwise/backups/product.

Use a suitable isolated worktree, preserving concurrent work. Verify its base
against the intended task and live release; the default branch is not
automatically deployed. Do not print protected environment values.

[Production readiness](production-readiness.md) owns verification and release
identity. [Rollback](rollback.md) owns recovery. Hermes is separate; its
generation runtime selector is documented in
/projects/frank/docs/AD_TEMPLATE_GENERATOR.md, not pinned to a repair worktree
or hard-coded release in this access guide.
