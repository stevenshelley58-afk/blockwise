import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  refundReservedTrialCredit,
  reserveAdStudioGenerationCredit,
  type AdStudioGenerationTrialReservation,
} from "@/lib/adstudio/generation-trial";
import { enrichCampaignPackCopyWithAi } from "@/lib/adstudio/campaign-copy-enrichment";
import { compactAdStudioCampaignPackForTransport, persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { resolveAdStudioGenerationBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { AD_STUDIO_TEMPLATES, FIRST_AD_FORMATS, mapAdStudioLibraryTemplate, resolveAdStudioTemplate, type AdStudioBrandKit, type AdStudioFormat, type AdStudioGoal, type AdStudioLibraryTemplate, type AdStudioPlatform, type FirstAdInput } from "@/lib/adstudio";
import { isBuiltInAdStudioTemplate } from "@/lib/adstudio/templates.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type CreateCampaignBody = {
  brandKit?: AdStudioBrandKit;
  goal?: AdStudioGoal;
  suburb?: string;
  city?: string;
  state?: string;
  offerId?: string;
  platforms?: AdStudioPlatform[];
  creativeFormats?: AdStudioFormat[];
  variantCount?: number;
  firstAd?: FirstAdInput;
  sourceImageDataUrl?: string;
};

const inFlightGenerations = new Map<string, number>();
const GENERATION_DEDUP_TTL_MS = 30_000;

// Mined ("radar") templates have no built-in template id, so resolveAdStudioTemplate
// can't see them and the chosen template never reaches generation. Fetch the live
// template by key and assemble its server-only generation direction (mined copy +
// layout/imagery recipe) so the AI copy actually follows that template's proven
// angle, hook and offer. Never returned to the client.
async function resolveLiveTemplateDirection(templateKey: string): Promise<{ name: string; hint: string } | null> {
  try {
    const research = createSupabaseServiceClient().schema("research");
    const { data, error } = await research
      .from("v_ad_template_library")
      .select("template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,ai_prompt_seed,compliance_note")
      .eq("template_key", templateKey)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as AdStudioLibraryTemplate;
    const mapped = mapAdStudioLibraryTemplate(row);
    const hint = [row.headline, row.primary_text, row.description, row.ai_prompt_seed, row.cta ? `CTA: ${row.cta}` : "", row.compliance_note]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join("\n");
    if (!mapped || !hint) return null;
    return { name: mapped.name, hint };
  } catch {
    return null;
  }
}

function isAdStudioImageSrc(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith("data:image/") ||
      value?.startsWith("/api/adstudio/media?") ||
      value?.startsWith("/ads/"),
  );
}

function validateFirstAd(firstAd: FirstAdInput | undefined): string | null {
  if (!firstAd) return null;
  if (firstAd.mode !== "template" && firstAd.mode !== "custom") return "Invalid first ad start mode.";
  if (!firstAd.description?.trim()) return "A short description is required.";
  if (firstAd.description.length > 500) return "Description must be 500 characters or less.";
  if (!isAdStudioImageSrc(firstAd.imageDataUrl)) return "An uploaded image is required.";
  if (JSON.stringify(firstAd.formats) !== JSON.stringify(FIRST_AD_FORMATS)) {
    return "First ad formats must be Story, Feed, and Square.";
  }
  if (firstAd.mode === "template" && !AD_STUDIO_TEMPLATES.some((template) => template.id === firstAd.templateId)) {
    return "Selected template was not found.";
  }
  return null;
}

function generationDedupKey(workspaceId: string, body: unknown): string {
  const text = JSON.stringify(body) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${workspaceId}:${hash}`;
}

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const { data, error } = await context.supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", context.access.workspaceId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<CreateCampaignBody>(request);
  const dedupKey = generationDedupKey(context.access.workspaceId, body);
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
    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
    }

    const trialGate = await reserveAdStudioGenerationCredit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      actorProfileId: context.access.userId,
    });

    if (!trialGate.ok) {
      return trialGate.response;
    }

    trialReservation = trialGate.reservation;

    const brandKitResult = await resolveAdStudioGenerationBrandKit({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      workspaceName: context.access.workspaceName,
      region: context.access.region,
      userId: context.access.userId,
      submittedBrandKit: body.brandKit,
      isTrialWorkspace: trialReservation.isTrialWorkspace,
    });

    if (!brandKitResult.ok) {
      await refundReservedTrialCredit(trialReservation);
      return NextResponse.json({ error: brandKitResult.error }, { status: brandKitResult.status });
    }

    let pack = generateAdStudioCampaignPack({
      workspaceId: context.access.workspaceId,
      brandKit: brandKitResult.brandKit,
      goal: body.goal ?? "seller_leads",
      suburb: body.suburb ?? "Scarborough",
      city: body.city ?? "Perth",
      state: body.state ?? "WA",
      offerId: body.offerId ?? "seller_prep_checklist",
      // Google Ads parked for Meta-only v1 (see src/lib/config/feature-flags.ts). Was: ["meta", "google_search", "google_pmax", "google_demand_gen"]
      platforms: body.platforms ?? ["meta"],
      creativeFormats: body.creativeFormats,
      variantCount: body.variantCount ?? 5,
      firstAd: body.firstAd,
      sourceImageDataUrl: body.sourceImageDataUrl,
    });
    const builtInTemplate = body.firstAd?.mode === "template" ? resolveAdStudioTemplate(body.firstAd.templateId) : null;
    const liveTemplate =
      !builtInTemplate && body.firstAd?.templateKey && !isBuiltInAdStudioTemplate(body.firstAd.templateKey)
        ? await resolveLiveTemplateDirection(body.firstAd.templateKey)
        : null;
    const sourceImageUrl = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      body.sourceImageDataUrl ?? body.firstAd?.imageDataUrl,
    );
    pack = await enrichCampaignPackCopyWithAi({
      pack,
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      brief: body.firstAd?.description,
      templateName: builtInTemplate?.name ?? liveTemplate?.name,
      templateHint: builtInTemplate?.promptHint ?? liveTemplate?.hint,
      sourceImageUrl,
    });
    const persisted = await persistAdStudioCampaignPack(context.supabase, pack, context.access.userId);

    if (persisted.error) {
      await refundReservedTrialCredit(trialReservation);
    }

    const liveResult = buildAdStudioLiveResult({
      data: compactAdStudioCampaignPackForTransport(pack),
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json(
      {
        campaignPack: liveResult.data,
        data: liveResult.data,
        persistence: liveResult.persistence,
      },
      { status: 201 },
    );
  } catch (error) {
    await refundReservedTrialCredit(trialReservation);
    return errorResponse(error, 400);
  } finally {
    inFlightGenerations.delete(dedupKey);
  }
}
