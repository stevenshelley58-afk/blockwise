import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { resolveMetaConnectionSetup, validateMetaConnectionSetup } from "@/lib/providers/meta-execution";

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
 * BLOCKWISE_ENABLE_PROVIDER_WRITES plus connected accounts and platform app
 * review. This endpoint never writes to a provider.
 */
export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const writesEnabled = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
  const connections = await listProviderConnections(context.supabase, context.access.workspaceId);

  const metaConnection = connections.find((connection) => connection.provider === "meta");
  const metaSetup = resolveMetaConnectionSetup(metaConnection?.metadata ?? {}, metaConnection?.externalAccountId);
  const metaSetupBlockers = metaConnection?.status === "connected" ? validateMetaConnectionSetup(metaSetup) : [];
  const metaReadiness: ProviderReadiness = {
    connected: metaConnection?.status === "connected",
    status: metaConnection?.status ?? "not_connected",
    accountId: metaConnection?.externalAccountId ?? null,
  };

  const checklist = [
    {
      id: "meta_connected",
      label: "Connect a Meta ad account",
      done: metaReadiness.connected,
      automatic: true,
    },
    ...(metaReadiness.connected && metaSetupBlockers.length === 0
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
      label: "Enable live publishing for this workspace",
      done: writesEnabled,
      automatic: true,
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
