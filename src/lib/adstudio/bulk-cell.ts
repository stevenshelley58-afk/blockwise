import { createHash } from "node:crypto";

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOpenAiImageProvider, createOpenRouterImageProvider } from "./ai-providers.ts";
import { runCreativeQA } from "./creative-qa.ts";
import { deterministicUuid } from "./id.ts";
import { generateAdStudioCampaignPack } from "./generator.ts";
import type { ImageProviderAdapter, TextProviderAdapter } from "./providers.ts";
import type { StyleDescriptor } from "./style-profile.ts";
import type { AdStudioBrandKit, AdStudioFormat } from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type BulkCellInput = {
  templateId: string;
  suburb: string;
  state: string;
  format: AdStudioFormat;
  brandKit: AdStudioBrandKit;
  // Optional: owned listing photo. Required for listing/sold/open-home templates.
  ownedPhotoUrl?: string;
  // Style profile to guide image generation (from radar, text only — no pixels).
  styleDescriptor?: StyleDescriptor;
  // Persona key for brand templates that use a synthetic agent.
  syntheticAgentPersonaKey?: string;
  visionProvider: TextProviderAdapter;
  imageProvider?: ImageProviderAdapter;
  knownContentHashes?: string[];
  maxRolls?: number;
};

export type BulkCellResult = {
  variantId: string;
  campaignId: string;
  imageUrl: string;
  copyText: string;
  score: number;
  gateResults: Record<string, unknown>;
  styleProfileGuidance: string | null;
  status: "draft";
  error: string | null;
};

const MAX_ROLLS_DEFAULT = 3;
const LISTING_TEMPLATE_PATTERN = /listing|sold|open.?home|appraisal/i;

export async function generateBulkCell(
  supabase: SupabaseServerClient,
  input: BulkCellInput,
): Promise<BulkCellResult> {
  const maxRolls = input.maxRolls ?? MAX_ROLLS_DEFAULT;
  const isListingTemplate = LISTING_TEMPLATE_PATTERN.test(input.templateId);

  // Listing templates require an owned photo — guardrail #3.
  if (isListingTemplate && !input.ownedPhotoUrl) {
    return failResult(input, "Listing/sold/open-home templates require an owned property photo.");
  }

  const imageProvider = input.imageProvider ?? chooseImageProvider(input.templateId);
  const imagePrompt = buildImagePrompt(input);
  const referenceAssets = input.ownedPhotoUrl ? [input.ownedPhotoUrl] : [];
  const campaignPack = generateAdStudioCampaignPack({
    workspaceId: input.brandKit.workspaceId,
    brandKit: input.brandKit,
    goal: "seller_leads",
    suburb: input.suburb,
    city: input.suburb,
    state: input.state,
    offerId: offerIdForTemplate(input.templateId),
    platforms: ["meta"],
    creativeFormats: [input.format],
    variantCount: 1,
  });

  const campaign = campaignPack.campaign;
  const variant = campaignPack.variants[0]!;
  const copyText = [variant.headline, ...(campaignPack.copyPacks[0]?.meta.primaryText ?? [])].join(" ");
  const scoreDimensions = {
    offerClarity: variant.score.dimensions.offerClarity,
    localRelevance: variant.score.dimensions.localRelevance,
    leadIntentStrength: variant.score.dimensions.leadIntentStrength,
    brandFit: variant.score.dimensions.brandFit,
    complianceSafety: variant.score.dimensions.complianceSafety,
    visualHierarchy: variant.score.dimensions.visualHierarchy,
  };

  // Generate up to maxRolls image candidates and keep the first that passes QA.
  for (let roll = 0; roll < maxRolls; roll++) {
    let assetUrl: string;

    try {
      const generated = await imageProvider.generate({
        prompt: imagePrompt,
        referenceAssets,
        aspectRatio: formatToAspect(input.format),
        stylePreset: "real_estate_photography",
        seed: deterministicSeed(input, roll),
      });
      assetUrl = generated.assetUrl;
    } catch {
      continue;
    }

    if (!assetUrl) continue;

    const candidateHash = contentHash(assetUrl);
    const qa = await runCreativeQA({
      imageUrl: assetUrl,
      copyText,
      scoreDimensions,
      candidateContentHash: candidateHash,
      knownContentHashes: input.knownContentHashes ?? [],
      visionProvider: input.visionProvider,
    });

    if (!qa.pass) continue;

    const variantId = deterministicUuid(`bulk:${campaign.campaignId}:${input.format}:${roll}`);

    await persistBulkDraft(supabase, {
      variantId,
      campaignId: campaign.campaignId,
      workspaceId: input.brandKit.workspaceId,
      headline: variant.headline,
      format: input.format,
      score: qa.score,
      gateResults: qa.gates,
      styleGuidance: styleGuidanceText(input.styleDescriptor),
      imageUrl: assetUrl,
      copyText,
    });

    return {
      variantId,
      campaignId: campaign.campaignId,
      imageUrl: assetUrl,
      copyText,
      score: qa.score,
      gateResults: qa.gates as Record<string, unknown>,
      styleProfileGuidance: styleGuidanceText(input.styleDescriptor),
      status: "draft",
      error: null,
    };
  }

  return failResult(input, `All ${maxRolls} image generation attempts failed QA gates.`);
}

async function persistBulkDraft(
  supabase: SupabaseServerClient,
  input: {
    variantId: string;
    campaignId: string;
    workspaceId: string;
    headline: string;
    format: AdStudioFormat;
    score: number;
    gateResults: unknown;
    styleGuidance: string | null;
    imageUrl: string;
    copyText: string;
  },
): Promise<void> {
  await supabase.from("adstudio_campaign_variants").upsert(
    {
      id: input.variantId,
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      angle: `bulk:${input.format}`,
      headline: input.headline,
      offer: "bulk_generated",
      cta: "LEARN_MORE",
      score_json: { score: input.score, notes: [], warnings: [], dimensions: {} },
      status: "draft",
      locked_fields_json: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  await supabase.from("adstudio_creatives").upsert(
    {
      id: deterministicUuid(`creative:${input.variantId}`),
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      variant_id: input.variantId,
      format: input.format,
      width: aspectToWidth(input.format),
      height: aspectToHeight(input.format),
      canvas_json: {
        width: aspectToWidth(input.format),
        height: aspectToHeight(input.format),
        backgroundAssetId: null,
        objects: [],
        metadata: {
          bulk_generated: true,
          style_guidance: input.styleGuidance,
          qa_gates: input.gateResults,
          image_url: input.imageUrl,
          copy_text: input.copyText,
        },
      },
      render_status: "rendered",
      preview_svg: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

function chooseImageProvider(templateId: string): ImageProviderAdapter {
  // Hero listing/agent shots → GPT Image 2 (highest quality).
  // Stat cards, backgrounds → Gemini Flash (cheaper).
  return /listing|sold|agent|appraisal/i.test(templateId)
    ? createOpenAiImageProvider()
    : createOpenRouterImageProvider();
}

function buildImagePrompt(input: BulkCellInput): string {
  const parts: string[] = [
    `Australian real estate advertisement background for ${input.suburb}, ${input.state}.`,
    "Authentically Australian: Colorbond or tiled roofs, native gardens, eucalypt street trees, clear blue sky.",
    "Photoreal, editorial quality, clean copy-safe space for text overlay.",
    "No rendered text, no US cues, no American signage.",
  ];

  if (input.styleDescriptor) {
    const d = input.styleDescriptor;
    if (d.composition) parts.push(`Composition: ${d.composition}.`);
    if (d.lighting) parts.push(`Lighting: ${d.lighting}.`);
    if (d.time_of_day) parts.push(`Time of day: ${d.time_of_day}.`);
    if (d.mood) parts.push(`Mood: ${d.mood}.`);
    if (d.palette?.length) parts.push(`Palette reference: ${d.palette.slice(0, 3).join(", ")}.`);
  }

  if (input.syntheticAgentPersonaKey) {
    parts.push("Include a professional real estate agent (fictional person, unnamed, AU professional setting).");
  }

  return parts.join(" ");
}

function styleGuidanceText(descriptor: StyleDescriptor | undefined): string | null {
  if (!descriptor) return null;
  return `composition: ${descriptor.composition}; lighting: ${descriptor.lighting}; mood: ${descriptor.mood}`;
}

function offerIdForTemplate(templateId: string): string {
  if (/appraisal|price|value/i.test(templateId)) return "home_value_update";
  if (/sold|sale|result/i.test(templateId)) return "recent_sales_report";
  if (/open.?home|inspect/i.test(templateId)) return "open_home_followup";
  if (/market|suburb|report/i.test(templateId)) return "suburb_market_report";
  return "seller_prep_checklist";
}

function formatToAspect(format: AdStudioFormat): string {
  const map: Record<string, string> = {
    "1:1": "1:1",
    "4:5": "4:5",
    "9:16": "9:16",
    "1.91:1": "1.91:1",
  };
  return map[format] ?? "1:1";
}

function aspectToWidth(format: AdStudioFormat): number {
  return format === "1.91:1" ? 1792 : format === "9:16" ? 1024 : 1024;
}

function aspectToHeight(format: AdStudioFormat): number {
  return format === "9:16" ? 1792 : format === "1.91:1" ? 1024 : 1024;
}

function deterministicSeed(input: BulkCellInput, roll: number): number {
  const raw = `${input.templateId}:${input.suburb}:${input.format}:${roll}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  return parseInt(hex.slice(0, 8), 16) % 100_000;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function failResult(input: BulkCellInput, errorMsg: string): BulkCellResult {
  return {
    variantId: "",
    campaignId: "",
    imageUrl: "",
    copyText: "",
    score: 0,
    gateResults: {},
    styleProfileGuidance: styleGuidanceText(input.styleDescriptor),
    status: "draft",
    error: errorMsg,
  };
}
