# Product edge reboot recovery

## Incident

The VPS rebooted at 2026-09-13 05:21 UTC. The Blockwise application and its
data services returned, but `product-caddy` did not. The public Frank edge
could not resolve the missing `product-caddy` upstream, so customer routes,
including `/login`, returned HTTP 502 until 05:36 UTC.

No application crash, data loss, provider write or customer-data mutation was
observed. The application continued to report the compiled revision
`688e63308581f9d8c389f6899cb3d6472506f5ad` after recovery.

## Root cause

The failed proxy container bind-mounted its Caddyfile from release
`6a76cc9a381e32229dc9c31cb9368ee1cde6a7e8`. Release pruning removed that
directory while the running container still used the mount. Linux kept the
existing mount usable, hiding the broken dependency. On reboot, Docker could
not mount the deleted source path and refused to start the proxy.

The Docker journal recorded the missing source path and mount failure. The
outer edge recorded 502 responses caused by the absent `product-caddy` DNS
target. Recreating only the proxy from the current retained release restored
the route at 05:36 UTC.

## Prevention

- Release pruning now inspects every running and stopped Docker container and
  retains any release supplying one of its bind mounts.
- Pruning fails closed if a container already references a missing release.
- The product proxy healthcheck now exercises `/api/health`, so it cannot
  report healthy while the real application route is returning 502.
- Regression tests simulate the delayed reboot failure and protect both the
  mount-retention rule and the routed healthcheck.

## Verification

The focused infrastructure and pruning tests must pass before merge. Normal
repository gates and the immutable production release procedure remain the
release authority. After deployment, verify the exact compiled revision with
`scripts/vps/product-health.sh <full-sha>` and confirm the proxy container's
mount source exists in retained release storage.
