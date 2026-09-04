# Frank operations-bundle integrity handoff

The Blockwise worker is the single writer for the Frank projection root. The
production product-worker mounts `/srv/frank/data/ops-projections` read/write;
the standalone worker definition deliberately has no projection-root mount.
Frank mounts that same host root read-only (`/ops-projections:ro`) on its
private network, with `HERMES_OPS_PROJECTION_ROOT=/ops-projections`.

Frank #122 is the accepted consumer for this contract. It reads `manifest.json`
and verifies the exact
pointer SHA, bundle SHA, every listed file hash, generation identity and
complete file set, publication receipt, source revision/receipt/workspace
metadata, and freshness before exposing a projection. The Blockwise-side
Compose handoff is recorded in `infra/frank/docker-compose.customer-ops.yml`;
apply that override to the Frank deployment and confirm its service name before
starting the stack.

The handoff is fail-closed: do not run a second projection writer, do not mount
the projection root read/write into Frank, and stop the deployment if the
Frank-side read-only mount or #122 integrity checks are absent. The runtime
receipt must include the worker revision and publication receipt before the
staging smoke gates are accepted.
