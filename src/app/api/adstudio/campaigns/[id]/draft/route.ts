import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  compactAdStudioCampaignPackForTransport,
  loadAdStudioCampaignPack,
  persistAdStudioCampaignPack,
} from "@/lib/adstudio/persistence";
import type { AdStudioCampaignPack } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type DraftBody = {
  campaignPack?: AdStudioCampaignPack;
};

// navigator.sendBeacon can only POST; the unload flush uses it with the same payload.
export async function POST(request: NextRequest, context: RouteContext) {
  return PATCH(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<DraftBody>(request);

  try {
    if (!body.campaignPack) {
      return NextResponse.json({ error: "campaignPack is required." }, { status: 400 });
    }

    if (body.campaignPack.campaign.campaignId !== id) {
      return NextResponse.json({ error: "Campaign ID does not match draft payload." }, { status: 400 });
    }

    const existingPack = await loadAdStudioCampaignPack(access.supabase, access.access.workspaceId, id);
    const submittedPack = normalizeSubmittedCampaignPack(
      body.campaignPack,
      id,
      access.access.workspaceId,
      existingPack?.brandKit ?? body.campaignPack.brandKit,
      existingPack?.campaign.brandKitId ?? body.campaignPack.brandKit.brandKitId,
    );
    const campaignPack = existingPack ? mergeCampaignPack(existingPack, submittedPack) : submittedPack;

    const persisted = await persistAdStudioCampaignPack(access.supabase, campaignPack, access.access.userId);

    // A silent "Saved" over an unsaved draft is how users lose work: fail the
    // request so the client shows the retryable error state instead.
    if (persisted.error) {
      return NextResponse.json(
        { error: `Draft could not be saved (${persisted.error.message}).` },
        { status: 500 },
      );
    }

    const responsePack = (await loadAdStudioCampaignPack(access.supabase, access.access.workspaceId, id)) ?? campaignPack;
    const liveResult = buildAdStudioLiveResult({
      data: compactAdStudioCampaignPackForTransport(responsePack),
    });

    return NextResponse.json({
      campaignPack: liveResult.data,
      data: liveResult.data,
      persistence: liveResult.persistence,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

function mergeCampaignPack(existing: AdStudioCampaignPack, submitted: AdStudioCampaignPack): AdStudioCampaignPack {
  return {
    ...existing,
    campaign: {
      ...existing.campaign,
      ...submitted.campaign,
      campaignId: existing.campaign.campaignId,
      workspaceId: existing.campaign.workspaceId,
      brandKitId: existing.campaign.brandKitId,
    },
    variants: mergeById(existing.variants, submitted.variants, (variant) => variant.variantId),
    creatives: mergeById(existing.creatives, submitted.creatives, (creative) => creative.creativeId),
    copyPacks: mergeById(existing.copyPacks, submitted.copyPacks, (copyPack) => copyPack.copyPackId),
    compliance: {
      ...existing.compliance,
      ...submitted.compliance,
      campaignId: existing.campaign.campaignId,
    },
  };
}

function normalizeSubmittedCampaignPack(
  pack: AdStudioCampaignPack,
  campaignId: string,
  workspaceId: string,
  brandKit: AdStudioCampaignPack["brandKit"],
  brandKitId: string,
): AdStudioCampaignPack {
  return {
    ...pack,
    brandKit: {
      ...brandKit,
      workspaceId,
    },
    campaign: {
      ...pack.campaign,
      campaignId,
      workspaceId,
      brandKitId,
    },
    variants: pack.variants.map((variant) => ({
      ...variant,
      campaignId,
    })),
    creatives: pack.creatives.map((creative) => ({
      ...creative,
      campaignId,
    })),
    copyPacks: pack.copyPacks.map((copyPack) => ({
      ...copyPack,
      campaignId,
    })),
    compliance: {
      ...pack.compliance,
      campaignId,
    },
  };
}

function mergeById<T>(existing: T[], submitted: T[], getId: (item: T) => string): T[] {
  const submittedById = new Map(submitted.map((item) => [getId(item), item]));
  const merged = existing.map((item) => submittedById.get(getId(item)) ?? item);
  const existingIds = new Set(existing.map(getId));
  return [...merged, ...submitted.filter((item) => !existingIds.has(getId(item)))];
}
