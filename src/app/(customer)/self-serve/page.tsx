import { createHash } from "node:crypto";
import { Suspense } from "react";

import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { AuditClaimHandler } from "@/components/audit-claim-handler";
import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { HomeDashboardReadModel } from "@/components/self-serve/home-dashboard-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadHomeDashboardData } from "@/lib/home/home-dashboard-data";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { seedMissingWorkspacePostcode } from "@/lib/workspace/default-postcode";

export const dynamic = "force-dynamic";

export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const serviceSupabase = createSupabaseServiceClient();
  const { data: authUser } = await supabase.auth.getUser();
  if (authUser.user) {
    await seedMissingWorkspacePostcode({
      serviceSupabase,
      user: authUser.user,
      workspaceId: access.workspaceId,
    }).catch(() => undefined);
  }
  const model = await Sentry.startSpan(
    {
      name: "Load Home read model",
      op: "db.home_dashboard",
      attributes: { "workspace.id": access.workspaceId },
    },
    () =>
      loadHomeDashboardData({
        supabase,
        serviceSupabase,
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
        canManageLocation: access.isOperator || access.role === "owner" || access.role === "admin",
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
      <Suspense>
        <AuditClaimHandler workspaceId={access.workspaceId} />
      </Suspense>
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
