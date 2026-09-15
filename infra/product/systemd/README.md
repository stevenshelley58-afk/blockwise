# Product service units

## Release automation

Install the committed deployment runner, release-aware pruning wrapper, and
their units from the release being activated:

    sudo scripts/vps/install-product-release-automation.sh

The deployment runner prepares through the canonical checkout, then deploys
and prunes with scripts from the immutable target release. The weekly pruner
reads `.autodeploy.sha` and executes the pruning implementation in that selected
release. This prevents a dirty or stale canonical checkout from bypassing
current retention safety.

# Private research email location projection

The location synchronizer is separate from the Hermes Ad DB worker. It reads
only the research `agents` relation, builds hash-to-postcode hints in memory,
and replaces the service-only product snapshot through one atomic RPC. It does
not run collection, provider calls, outreach, or email delivery.

After the exact revision is merged, its product migrations are applied, and
the normal immutable product release is healthy, prepare then activate the
same current `origin/main` revision:

    sudo scripts/vps/install-research-email-location-projection.sh <full-sha>
    sudo scripts/vps/install-research-email-location-projection.sh <full-sha> --activate

Preparation creates a clean detached release and a least-privilege environment
containing only the two database endpoints and credentials. Activation moves
the selector to that immutable release, runs the synchronizer once, then
enables its 15-minute timer. Never use `hermes-ad-db-worker.service` to operate
this projection.
