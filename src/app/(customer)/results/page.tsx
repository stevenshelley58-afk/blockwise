import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { MetaMonitorDashboard, type OAuthNotice } from "@/components/monitor/MetaMonitorDashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { hasNoMetaConnection } from "@/lib/meta-monitor/payload-state";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { loadReportingSnapshot } from "@/lib/meta-monitor/reporting-snapshots";
import { buildSampleMetaMonitorPayload } from "@/lib/meta-monitor/sampleMetaMonitorData";

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
  const explicitExample = resolvedParams.example === "1";
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const requestedPlanId = typeof resolvedParams.planId === "string" ? resolvedParams.planId.trim() : "";
  let focusCampaignId: string | null = null;
  if (requestedPlanId) {
    const { data: focusPlan } = await supabase
      .from("meta_publish_plans")
      .select("reconciled_objects_json")
      .eq("workspace_id", access.workspaceId)
      .eq("id", requestedPlanId)
      .maybeSingle();
    const reconciled = focusPlan?.reconciled_objects_json as { campaignId?: unknown } | null | undefined;
    focusCampaignId = typeof reconciled?.campaignId === "string" && reconciled.campaignId.trim()
      ? reconciled.campaignId.trim()
      : null;
  }
  const reporting = await Sentry.startSpan(
    {
      name: "Load Performance reporting snapshot",
      op: "db.reporting_snapshot",
      attributes: { "workspace.id": access.workspaceId },
    },
    () =>
      loadReportingSnapshot({
        supabase,
        workspaceId: access.workspaceId,
        range: "last_30",
      }),
  );
  if (reporting.needsRefresh) {
    after(async () => {
      await queueReportingRefresh({
        workspaceId: access.workspaceId,
        range: "last_30",
        reason: "stale_navigation",
      }).catch(() => undefined);
    });
  }

  const oauthNotice = resolveOAuthNotice(resolvedParams);
  // Nothing connected: open the example report instead of a connect
  // interstitial. It is labelled as an example and keeps the Connect Meta
  // action, so the customer sees what Results will hold rather than a dead end.
  const showExample = explicitExample || hasNoMetaConnection(reporting.snapshot.payload);
  const initialPayload = showExample
    ? buildSampleMetaMonitorPayload({ range: "last_30", now: new Date(), connected: false })
    : reporting.snapshot.payload;

  return (
    <MetaMonitorDashboard
      key={showExample ? "example" : "live"}
      initialPayload={initialPayload}
      initialEtag={reporting.snapshot.etag}
      initialGeneratedAt={reporting.snapshot.generatedAt}
      userId={access.userId}
      workspaceId={access.workspaceId}
      // Partner-access connect: the customer shares assets in Meta, confirms
      // it on one screen, and an operator verifies the rest.
      metaConnectHref="/connect-meta"
      oauthNotice={oauthNotice}
      focusCampaignId={focusCampaignId}
      showExample={showExample}
    />
  );
}
