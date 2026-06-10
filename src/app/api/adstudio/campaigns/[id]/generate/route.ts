import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  refundReservedTrialCredit,
  reserveAdStudioGenerationCredit,
  type AdStudioGenerationTrialReservation,
} from "@/lib/adstudio/generation-trial";
import { enrichCampaignPackCopyWithAi } from "@/lib/adstudio/campaign-copy-enrichment";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { compactAdStudioCampaignPackForTransport, persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { checkRateLimit } from "@/lib/rate-limit";
import type { AdStudioBrandKit } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

// B5 request dedup: a duplicate concurrent generate (e.g. a double-click) would
// double-reserve trial credits and fire a second upstream generation. Track
// in-flight request keys in module memory; an identical request that arrives
// while the first is still running gets 409. Entries are removed when the
// request settles, so normal sequential generates are unaffected; the TTL is a
// safety net in case cleanup never runs.
const inFlightGenerations = new Map<string, number>();
const GENERATION_DEDUP_TTL_MS = 30_000;

function generationDedupKey(workspaceId: string, campaignId: string, body: unknown): string {
  const text = JSON.stringify(body) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${workspaceId}:${campaignId}:${hash}`;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: campaignId } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const rateLimit = await checkRateLimit(
    access.supabase,
    access.access.workspaceId,
    access.access.userId,
    { windowSeconds: 3600, maxRequests: 10, bucket: "ai-generate-pack" },
  );
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<{
    brandKit?: AdStudioBrandKit;
    variantCount?: number;
    suburb?: string;
    sourceImageDataUrl?: string;
  }>(request);

  const dedupKey = generationDedupKey(access.access.workspaceId, campaignId, body);
  const inFlightSince = inFlightGenerations.get(dedupKey);
  if (inFlightSince !== undefined && Date.now() - inFlightSince < GENERATION_DEDUP_TTL_MS) {
    return NextResponse.json(
      { error: "This generation is already running. Wait for it to finish before retrying." },
      { status: 409 },
    );
  }
  inFlightGenerations.set(dedupKey, Date.now());

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

    let pack = generateAdStudioCampaignPack({
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
      sourceImageDataUrl: body.sourceImageDataUrl,
    });
    const sourceImageUrl = await resolveAdStudioImageForModel(
      access.supabase,
      access.access.workspaceId,
      body.sourceImageDataUrl,
    );
    pack = await enrichCampaignPackCopyWithAi({
      pack,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      sourceImageUrl,
    });
    const persisted = await persistAdStudioCampaignPack(access.supabase, pack, access.access.userId);

    if (persisted.error) {
      await refundReservedTrialCredit(trialReservation);
    }

    const liveResult = buildAdStudioLiveResult({
      data: compactAdStudioCampaignPackForTransport(pack),
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
  } finally {
    inFlightGenerations.delete(dedupKey);
  }
}
