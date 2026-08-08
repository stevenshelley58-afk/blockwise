import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { reconcileMetaConnectionStatus } from "@/lib/providers/meta-connection-health";
import { resolveMetaConnectionSetup, validateMetaConnectionSetup } from "@/lib/providers/meta-execution";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderReadiness = {
  connected: boolean;
  status: string;
  accountId: string | null;
};

/**
 * Read-only publish readiness check.
 *
 * Reports whether the workspace is set up to publish live ads to Meta
 * WITHOUT creating anything. Live publishing stays gated behind
 * BLOCKWISE_ENABLE_PROVIDER_WRITES plus connected accounts. This endpoint
 * never writes to a provider, but it does self-heal the stored connection
 * status from live token health — otherwise a stale "needs_attention" flag
 * disables the Submit button, and the publish POST that would have repaired
 * the flag can never be sent.
 */
export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const writesEnabled = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
  const connections = await listProviderConnections(context.supabase, context.access.workspaceId);

  const metaConnection =
    connections.find((connection) => connection.provider === "meta" && (connection.status === "connected" || connection.status === "needs_attention"))
    ?? connections.find((connection) => connection.provider === "meta");
  const metaSetup = resolveMetaConnectionSetup(metaConnection?.metadata ?? {}, metaConnection?.externalAccountId);
  const metaStatus = metaConnection
    ? await reconcileMetaConnectionStatus(createSupabaseServiceClient(), metaConnection)
    : "not_connected";
  // Setup blockers are shown for any USABLE connection — hiding them while the
  // status is "needs_attention" (exactly when they explain what needs
  // attention) left users reconnecting in circles with no way forward. A
  // deliberately disconnected row shows only the connect step.
  const metaSetupBlockers = metaConnection && metaStatus !== "not_connected"
    ? validateMetaConnectionSetup(metaSetup)
    : [];
  const metaReadiness: ProviderReadiness = {
    connected: metaStatus === "connected",
    status: metaStatus,
    accountId: metaConnection?.externalAccountId ?? null,
  };

  const checklist = [
    {
      id: "meta_connected",
      label: "Connect a Meta ad account",
      done: metaStatus === "connected",
      automatic: true,
    },
    ...(metaConnection && metaStatus !== "not_connected" && metaSetupBlockers.length === 0
      ? [{
          id: "meta_setup",
          label: "Complete Meta publishing setup",
          done: true,
          automatic: true,
        }]
      : metaSetupBlockers.map((blocker, index) => ({
          id: `meta_setup_${index + 1}`,
          label: blocker,
          done: false,
          automatic: true,
        }))),
    {
      id: "provider_writes",
      label: writesEnabled
        ? "Live publishing enabled"
        : "Live publishing is in final platform review — export your creatives, or check back soon.",
      done: writesEnabled,
      automatic: true,
      blocked: !writesEnabled,
    },
  ];

  const blockers = checklist.filter((item) => !item.done).map((item) => item.label);
  const ready = blockers.length === 0;

  return NextResponse.json({
    workspaceId: context.access.workspaceId,
    providerWritesEnabled: writesEnabled,
    providers: {
      meta: metaReadiness,
    },
    setup: metaSetup,
    blockers,
    checklist,
    ready,
    note: "Read-only Meta check - no ads are created. Live publishing remains disabled until every step is complete.",
  });
}
