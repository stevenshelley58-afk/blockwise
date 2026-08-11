import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import { loadLatestMetaPublishPlanQueueState } from "@/lib/providers/meta-publish-queue";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const service = createSupabaseServiceClient();
    const plan = await loadMetaPublishPlan(service, {
      workspaceId: access.access.workspaceId,
      planId: id,
    });
    const queue = await loadLatestMetaPublishPlanQueueState({
      serviceSupabase: service,
      workspaceId: access.access.workspaceId,
      planId: id,
    });

    return NextResponse.json({
      status: plan.status,
      lastError: plan.lastError,
      queueStatus: queue?.status ?? null,
      queueError: queue?.lastError ?? null,
      reconciledObjects: {
        campaigns: plan.reconciledObjects.campaignId ? 1 : 0,
        leadForms: Object.keys(plan.reconciledObjects.leadFormIds).length,
        adSets: Object.keys(plan.reconciledObjects.adSetIds).length,
        creatives: Object.keys(plan.reconciledObjects.creativeIds).length,
        ads: Object.keys(plan.reconciledObjects.adIds).length,
      },
      // A workspace member may inspect the immutable inputs and provider IDs
      // for their own plan. This is deliberately limited to IDs, statuses,
      // hashes, and revision bindings: provider tokens, request bodies, and
      // lead payloads never leave the service-side plan record.
      readback: {
        complianceSubjectHash: plan.complianceSubjectHash,
        campaign: {
          providerId: plan.reconciledObjects.campaignId ?? null,
          plannedStatus: plan.campaign.status,
          effectiveStatus: plan.reconciledObjects.objectStatuses?.campaign?.effectiveStatus ?? null,
        },
        leadForms: plan.leadForms.map((form) => ({
          localId: form.localId,
          providerId: plan.reconciledObjects.leadFormIds[form.localId] ?? null,
          // The worker only records the ID after Meta's required form GET
          // succeeds, so this means the generated Instant Form was read back.
          readBack: plan.responseLog.some((entry) => entry.step === `lead_form.${form.localId}.verify` && entry.status && entry.status >= 200 && entry.status < 300),
        })),
        adSets: plan.adSets.map((adSet) => ({
          localId: adSet.localId,
          providerId: plan.reconciledObjects.adSetIds[adSet.localId] ?? null,
          plannedStatus: adSet.status,
          effectiveStatus: plan.reconciledObjects.objectStatuses?.adSets?.[adSet.localId]?.effectiveStatus ?? null,
        })),
        creatives: plan.creatives.map((creative) => ({
          localId: creative.localId,
          providerId: plan.reconciledObjects.creativeIds[creative.localId] ?? null,
          leadFormLocalId: creative.leadFormLocalId,
          leadFormProviderId: plan.reconciledObjects.leadFormIds[creative.leadFormLocalId] ?? null,
          revisionBindings: creative.revisionBindings.map((binding) => ({
            placement: binding.placement,
            format: binding.format,
            creativeId: binding.creativeId,
            revisionId: binding.revisionId,
            contentSha256: binding.asset.contentSha256 ?? null,
          })),
        })),
        ads: plan.ads.map((ad) => ({
          localId: ad.localId,
          providerId: plan.reconciledObjects.adIds[ad.localId] ?? null,
          plannedStatus: ad.status,
          effectiveStatus: plan.reconciledObjects.objectStatuses?.ads?.[ad.localId]?.effectiveStatus ?? null,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta publish plan was not found." },
      { status: 404 },
    );
  }
}
