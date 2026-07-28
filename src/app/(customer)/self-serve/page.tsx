import { createHash } from "node:crypto";

import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { HomeDashboardReadModel } from "@/components/self-serve/home-dashboard-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadHomeDashboardData } from "@/lib/home/home-dashboard-data";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const model = await Sentry.startSpan(
    {
      name: "Load Home read model",
      op: "db.home_dashboard",
      attributes: { "workspace.id": access.workspaceId },
    },
    () =>
      loadHomeDashboardData({
        supabase,
        serviceSupabase: createSupabaseServiceClient(),
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
      }),
  );
  if (model.reportingNeedsRefresh) {
    after(async () => {
      await queueReportingRefresh({
        workspaceId: access.workspaceId,
        range: "last_30",
        reason: "stale_navigation",
      }).catch(() => undefined);
    });
  }
  const etag = `"${createHash("sha256").update(JSON.stringify(model.safe)).digest("hex")}"`;

  return (
    <>
      <ConfirmRegistrationTracker />
      <HomeDashboardReadModel
        initialData={model.data}
        initialEtag={etag}
        initialGeneratedAt={model.reportingGeneratedAt}
        userId={access.userId}
        workspaceId={access.workspaceId}
      />
    </>
  );
}
