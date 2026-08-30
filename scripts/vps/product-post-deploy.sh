#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRANK_RECONCILE_HOOK="/projects/frank/apps/window/infra/control_plane/post-deploy.sh"

# A deployment is successful only after the canonical Blockwise health gate.
"$SCRIPT_DIR/product-health.sh"

# Reconciliation is an independently disableable evidence producer. Its own
# immutable failure receipt carries an outage; a healthy Blockwise release is
# not rolled back or reported failed merely because the control plane is down.
if [[ ! -f "$FRANK_RECONCILE_HOOK" || -L "$FRANK_RECONCILE_HOOK" || ! -x "$FRANK_RECONCILE_HOOK" ]]; then
  echo "warning: Frank post-deploy reconciliation hook is unavailable" >&2
elif ! "$FRANK_RECONCILE_HOOK"; then
  echo "warning: Blockwise is healthy but post-deploy reconciliation failed" >&2
fi

echo "Blockwise post-deploy health and reconciliation request complete"
