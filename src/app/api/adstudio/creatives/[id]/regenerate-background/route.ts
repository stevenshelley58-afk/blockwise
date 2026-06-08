import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider } from "@/lib/adstudio";
import { createImageProviderForCandidate } from "@/lib/adstudio/ai-providers";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "@/lib/adstudio/providers";
import { rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { assembleBackgroundPrompt } from "@/lib/operator/prompts/assemble-prompt";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { getActivePromptBundle, type PromptKey } from "@/lib/operator/prompts/prompt-registry";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type BackgroundGenerationResult = {
  output: ImageProviderResponse;
  provider: ImageProviderAdapter;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
};

const BACKGROUND_PROMPT_KEYS: PromptKey[] = [
  "adstudio.background.system",
  "adstudio.background.input_template",
  "adstudio.background.negative_prompt",
];

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const startedAt = Date.now();
  const correlationId = randomUUID();
  const creative = await loadCreative(access.supabase, access.access.workspaceId, id);

  if (!creative) {
    return NextResponse.json({ error: "Creative not found." }, { status: 404 });
  }

  const campaign = await loadCampaign(access.supabase, access.access.workspaceId, String(creative.campaign_id ?? ""));
  const brandKit = campaign?.brand_kit_id
    ? await loadBrandKit(access.supabase, access.access.workspaceId, String(campaign.brand_kit_id))
    : null;
  const bundle = await getActivePromptBundle(BACKGROUND_PROMPT_KEYS);
  const assembled = assembleBackgroundPrompt({
    bundle,
    creativeId: id,
    format: String(creative.format ?? "4:5"),
    campaign: campaign
      ? {
          goal: String(campaign.goal ?? ""),
          offer: String(campaign.offer_id ?? ""),
          market: summarizeMarket(campaign.market_json),
        }
      : undefined,
    brand: brandKit
      ? {
          palette: [brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent].filter(Boolean),
          styleTags: brandKit.visualStyle.styleTags,
          imageTreatment: brandKit.visualStyle.imageTreatment,
        }
      : undefined,
    brandKit,
  });
  const imageInput: ImageProviderRequest = {
    prompt: assembled.fullPrompt,
    negativePrompt: bundle["adstudio.background.negative_prompt"].body,
    referenceAssets: [],
    aspectRatio: String(creative.format ?? "4:5"),
    stylePreset: "premium_editorial_real_estate",
    seed: 27,
  };
  let generation: BackgroundGenerationResult | null = null;

  try {
    generation = await generateBackgroundWithProfile(imageInput);

    await recordAdStudioProviderRun({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      correlationId,
      taskType: "adstudio.background",
      modelProfile: "image_draft",
      prompt: assembled,
      input: {
        creativeId: id,
        format: creative.format,
        campaignId: creative.campaign_id,
        brandKitId: campaign?.brand_kit_id,
      },
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.provider.providerName,
      providerType: generation.provider.providerType,
      modelName: generation.output.model,
      output: generation.output,
      status: "completed",
    });

    return NextResponse.json({ creativeId: id, background: generation.output });
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      correlationId,
      taskType: "adstudio.background",
      modelProfile: "image_draft",
      prompt: assembled,
      input: {
        creativeId: id,
        format: creative.format,
        campaignId: creative.campaign_id,
        brandKitId: campaign?.brand_kit_id,
      },
      attempts: generation?.attempts ?? [],
      latencyMs: Date.now() - startedAt,
      providerName: generation?.provider.providerName ?? "unavailable",
      providerType: "image_generation",
      modelName: generation?.output.model ?? "unavailable",
      output: null,
      status: "failed",
      error,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Background generation failed." },
      { status: 502 },
    );
  }
}

async function generateBackgroundWithProfile(input: ImageProviderRequest): Promise<BackgroundGenerationResult> {
  const profile = await resolveRuntimeModelProfile("image_draft");
  const attempts: BackgroundGenerationResult["attempts"] = [];
  let lastError: unknown = null;

  for (const candidate of modelCandidateAttempts(profile)) {
    const provider = createImageProviderForCandidate(candidate);
    attempts.push({ provider: provider.providerName, model: candidate.model, status: "attempted" });

    try {
      const output = await provider.generate(input);
      attempts[attempts.length - 1] = { provider: provider.providerName, model: candidate.model, status: "completed" };
      return { output, provider, attempts };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model: candidate.model,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const fallbackProvider = createOpenAiImageProvider();
  attempts.push({ provider: fallbackProvider.providerName, model: "env_default", status: "attempted" });

  try {
    const output = await fallbackProvider.generate(input);
    attempts[attempts.length - 1] = { provider: fallbackProvider.providerName, model: "env_default", status: "completed" };
    return { output, provider: fallbackProvider, attempts };
  } catch (error) {
    attempts[attempts.length - 1] = {
      provider: fallbackProvider.providerName,
      model: "env_default",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    if (lastError instanceof Error) throw lastError;
    throw error;
  }
}

async function loadCreative(supabase: any, workspaceId: string, creativeId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("adstudio_creatives")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", creativeId)
    .maybeSingle();

  return data ?? null;
}

async function loadCampaign(supabase: any, workspaceId: string, campaignId: string): Promise<Record<string, unknown> | null> {
  if (!campaignId) return null;
  const { data } = await supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();

  return data ?? null;
}

async function loadBrandKit(supabase: any, workspaceId: string, brandKitId: string): Promise<AdStudioBrandKit | null> {
  const { data } = await supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", brandKitId)
    .maybeSingle();

  return data ? rowToBrandKit(data) : null;
}

function summarizeMarket(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const market = value as Record<string, unknown>;
  return [market.suburb, market.city, market.state].filter(Boolean).join(", ");
}
