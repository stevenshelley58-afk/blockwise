import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  refundReservedTrialCredit,
  reserveAdStudioGenerationCredit,
  type AdStudioGenerationTrialReservation,
} from "@/lib/adstudio/generation-trial";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";
import type { AdStudioBrandKit } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ brandKit?: AdStudioBrandKit; variantCount?: number; suburb?: string }>(request);
  let trialReservation: AdStudioGenerationTrialReservation | null = null;

  try {
    const trialGate = await reserveAdStudioGenerationCredit({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      actorProfileId: access.access.userId,
    });

    if (!trialGate.ok) {
      return trialGate.response;
    }

    trialReservation = trialGate.reservation;

    const brandKitResult = await resolveAdStudioGenerationBrandKit({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      workspaceName: access.access.workspaceName,
      region: access.access.region,
      userId: access.access.userId,
      submittedBrandKit: body.brandKit,
      isTrialWorkspace: trialReservation.isTrialWorkspace,
    });

    if (!brandKitResult.ok) {
      await refundReservedTrialCredit(trialReservation);
      return NextResponse.json({ error: brandKitResult.error }, { status: brandKitResult.status });
    }

    const pack = generateAdStudioCampaignPack({
      workspaceId: access.access.workspaceId,
      brandKit: brandKitResult.brandKit,
      goal: "seller_leads",
      suburb: body.suburb ?? "Scarborough",
      city: "Perth",
      state: "WA",
      offerId: "seller_prep_checklist",
      // Google Ads parked for Meta-only v1 (see src/lib/config/feature-flags.ts). Was: ["meta", "google_search", "google_pmax", "google_demand_gen"]
      platforms: ["meta"],
      variantCount: body.variantCount ?? 5,
    });
    const persisted = await persistAdStudioCampaignPack(access.supabase, pack, access.access.userId);

    if (persisted.error) {
      await refundReservedTrialCredit(trialReservation);
    }

    const liveResult = buildAdStudioLiveResult({
      data: pack,
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json({
      campaignPack: liveResult.data,
      data: liveResult.data,
      persistence: liveResult.persistence,
    });
  } catch (error) {
    await refundReservedTrialCredit(trialReservation);
    return errorResponse(error, 400);
  }
}
