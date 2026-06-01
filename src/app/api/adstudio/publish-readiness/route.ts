import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { listProviderConnections } from "@/lib/api-control/provider-connections";

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
 * Reports whether the workspace is set up to publish live ads to Meta/Google
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

  const toReadiness = (provider: "meta" | "google"): ProviderReadiness => {
    const match = connections.find((connection) => connection.provider === provider);
    return {
      connected: match?.status === "connected",
      status: match?.status ?? "not_connected",
      accountId: match?.externalAccountId ?? null,
    };
  };

  const providers = {
    meta: toReadiness("meta"),
    google: toReadiness("google"),
  };

  const checklist = [
    {
      id: "meta_connected",
      label: "Connect a Meta ad account",
      done: providers.meta.connected,
      automatic: true,
    },
    {
      id: "google_connected",
      label: "Connect a Google Ads account",
      done: providers.google.connected,
      automatic: true,
    },
    {
      id: "meta_app_review",
      label: "Meta app review approved (ads_management + leads_retrieval)",
      done: false,
      automatic: false,
    },
    {
      id: "google_app_review",
      label: "Google Ads API developer token / access approved",
      done: false,
      automatic: false,
    },
    {
      id: "provider_writes",
      label: "Enable live publishing (set BLOCKWISE_ENABLE_PROVIDER_WRITES=true)",
      done: writesEnabled,
      automatic: true,
    },
  ];

  const ready = writesEnabled && (providers.meta.connected || providers.google.connected);

  return NextResponse.json({
    workspaceId: context.access.workspaceId,
    providerWritesEnabled: writesEnabled,
    providers,
    checklist,
    ready,
    note: "Read-only check - no ads are created. Live publishing remains disabled until every step is complete.",
  });
}
