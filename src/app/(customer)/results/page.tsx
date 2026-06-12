import { MetaMonitorDashboard, type OAuthNotice } from "@/components/monitor/MetaMonitorDashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getMetaMonitorData } from "@/lib/meta-monitor/getMetaMonitorData";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function resolveOAuthNotice(searchParams: Record<string, string | string[] | undefined>): OAuthNotice | null {
  const integration = searchParams["integration"];
  const connected = searchParams["connected"];
  const error = searchParams["error"];
  const status = searchParams["status"];

  if (integration !== "meta") return null;

  if (connected === "1") {
    if (status === "needs_account") {
      return {
        tone: "warning",
        message: "Meta connected, but no Ad Account found. Go to Settings to complete setup.",
        settingsLink: true,
      };
    }
    return { tone: "success", message: "Meta connected successfully!" };
  }

  if (error === "invalid_state") {
    return { tone: "error", message: "Meta connection failed: invalid state. Please try again." };
  }
  if (error === "forbidden") {
    return { tone: "error", message: "Meta connection failed: access denied." };
  }
  if (error === "missing_config") {
    return { tone: "error", message: "Meta connection is not fully set up. Contact support." };
  }
  if (error === "missing_code") {
    return { tone: "error", message: "Meta connection was cancelled or did not complete. Try again." };
  }
  if (error === "disabled") {
    return { tone: "error", message: "Meta integration is currently disabled." };
  }
  if (error) {
    return { tone: "error", message: "Meta connection could not be completed. Please try again." };
  }

  return null;
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const initialPayload = await getMetaMonitorData({
    supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    range: "last_30",
  });

  const oauthNotice = resolveOAuthNotice(resolvedParams);

  return (
    <MetaMonitorDashboard
      initialPayload={initialPayload}
      metaConnectHref={`/api/integrations/meta/connect?workspaceId=${encodeURIComponent(access.workspaceId)}`}
      oauthNotice={oauthNotice}
    />
  );
}
