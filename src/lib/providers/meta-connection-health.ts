import type { ProviderConnectionStatus } from "../publishing/readiness.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { checkMetaConnectionHealth } from "./meta-assets.ts";
import { resolveMetaConnectionSetup, validateMetaConnectionSetup } from "./meta-execution.ts";
import { loadStoredProviderTokens, type ProviderConnectionMetadata } from "./provider-connections.ts";

export function publishableConnectionStatus(
  status: ProviderConnectionMetadata["status"] | undefined,
): ProviderConnectionStatus {
  if (status === "connected" || status === "needs_attention") {
    return status;
  }

  return "not_connected";
}

/**
 * Resolves the Meta connection's real publishable status from live token health
 * and setup completeness, ignoring the denormalised `status` column. That column
 * is written by several paths (OAuth callback, Settings GET/PATCH, a scheduled
 * health task) with inconsistent criteria — so a healthy, fully-configured
 * connection can sit at "needs_attention" and block every publish. The source of
 * truth is the token itself plus the setup, so check those and persist the
 * result so the dashboard and subsequent reads stop trusting the stale flag.
 *
 * Shared by the publish POST and the read-only publish-readiness GET: readiness
 * must never report a connection blocker that the publish itself would repair,
 * or the Submit button stays disabled and the repairing POST is never sent.
 */
export async function reconcileMetaConnectionStatus(
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>,
  connection: ProviderConnectionMetadata,
): Promise<ProviderConnectionStatus> {
  // A deliberately revoked/disconnected row must stay disconnected. Partner
  // connections store Blockwise's always-valid system token, so a live health
  // check would silently "resurrect" a connection the customer chose to
  // remove. Only reconcile rows that are supposed to be usable.
  if (connection.status !== "connected" && connection.status !== "needs_attention") {
    return "not_connected";
  }

  try {
    const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id);
    const health = await checkMetaConnectionHealth({
      accessToken: tokens.accessToken ?? "",
      tokenExpiresAt: connection.tokenExpiresAt,
    });
    const tokenUsable = health.status === "healthy" || health.status === "expiring_soon";
    const setupClean = validateMetaConnectionSetup(
      resolveMetaConnectionSetup(connection.metadata, connection.externalAccountId),
    ).length === 0;
    const reconciled: ProviderConnectionStatus = tokenUsable && setupClean ? "connected" : "needs_attention";

    if (reconciled !== connection.status) {
      await serviceSupabase
        .from("provider_connections")
        .update({
          status: reconciled,
          health_status: health.status,
          health_checked_at: health.checkedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id)
        .eq("workspace_id", connection.workspaceId)
        .eq("provider", "meta");
    }

    return reconciled;
  } catch {
    // A transient health-check failure must not block publish harder than the
    // stored status already would — fall back to it.
    return publishableConnectionStatus(connection.status);
  }
}
