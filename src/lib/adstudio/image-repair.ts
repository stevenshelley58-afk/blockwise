import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import type { AdStudioFormat } from "./types.ts";

export type ImageRepairCampaignContext = {
  goal?: string;
  offer?: string;
  market?: string;
  propertyType?: string;
  headline?: string;
  description?: string;
};

export type ImageRepairRequest = {
  brandKitId?: string;
  sourceImage?: string;
  targetFormats?: unknown;
  campaignContext?: ImageRepairCampaignContext;
  layoutBriefs?: Partial<Record<AdStudioFormat, string>>;
};

export type ImageRepairResult = {
  result: ImageProviderResponse;
  providerName: string;
  modelName: string;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
};

export const IMAGE_REPAIR_FORMATS = ["9:16", "4:5", "1:1", "1.91:1"] as const satisfies readonly AdStudioFormat[];

const REPAIR_MODE = "truth_preserving_fit";

export function validateImageRepairRequest(body: ImageRepairRequest): {
  sourceImage: string;
  targetFormats: AdStudioFormat[];
  brandKitId?: string;
  campaignContext: ImageRepairCampaignContext;
  layoutBriefs: Partial<Record<AdStudioFormat, string>>;
} {
  const sourceImage = typeof body.sourceImage === "string" ? body.sourceImage.trim() : "";
  if (!sourceImage) {
    throw new Error("sourceImage is required.");
  }

  const requestedFormats = Array.isArray(body.targetFormats) ? body.targetFormats : [];
  const invalidFormat = requestedFormats.some((format) => !IMAGE_REPAIR_FORMATS.includes(format as AdStudioFormat));
  const targetFormats = Array.from(new Set(requestedFormats)) as AdStudioFormat[];
  if (targetFormats.length === 0 || invalidFormat) {
    throw new Error("targetFormats must include valid Ad Studio formats.");
  }
  if (targetFormats.length > IMAGE_REPAIR_FORMATS.length) {
    throw new Error("Too many target formats.");
  }

  return {
    sourceImage,
    targetFormats,
    brandKitId: typeof body.brandKitId === "string" && body.brandKitId.trim() ? body.brandKitId.trim() : undefined,
    campaignContext: isRecord(body.campaignContext) ? (body.campaignContext as ImageRepairCampaignContext) : {},
    layoutBriefs: isRecord(body.layoutBriefs) ? (body.layoutBriefs as Partial<Record<AdStudioFormat, string>>) : {},
  };
}

export function supportsTruthPreservingRepair(provider: Pick<ImageProviderAdapter, "capabilities">): boolean {
  return Boolean(provider.capabilities.imageToImage && provider.capabilities.multiReference);
}

export async function generateTruthPreservingRepair(input: {
  imageInput: ImageProviderRequest;
  providers: ImageProviderAdapter[];
}): Promise<ImageRepairResult> {
  if (!input.imageInput.referenceAssets.length) {
    throw new Error("AI image repair requires a resolved reference image.");
  }

  const attempts: ImageRepairResult["attempts"] = [];
  let lastError: unknown = null;

  for (const provider of input.providers) {
    if (!supportsTruthPreservingRepair(provider)) {
      attempts.push({
        provider: provider.providerName,
        model: "unsupported",
        status: "failed",
        error: "Provider does not consume reference images.",
      });
      continue;
    }

    attempts.push({ provider: provider.providerName, model: "reference-capable", status: "attempted" });
    const attemptIndex = attempts.length - 1;
    try {
      const result = await provider.generate({
        ...input.imageInput,
        requiresReferenceAssets: true,
      });
      if (!result.assetUrl) {
        throw new Error("No repaired image was returned by the provider.");
      }
      attempts[attemptIndex] = {
        provider: provider.providerName,
        model: result.model,
        status: "completed",
      };
      return {
        result,
        providerName: provider.providerName,
        modelName: result.model,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attemptIndex] = {
        provider: provider.providerName,
        model: "reference-capable",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("No reference-capable image provider is configured.");
}

export function buildTruthPreservingRepairPrompt(input: {
  format: AdStudioFormat;
  campaignContext?: ImageRepairCampaignContext;
  layoutBrief?: string;
}): string {
  const context = input.campaignContext ?? {};
  return [
    "Truth-preserving real estate ad image repair.",
    `Target format: ${input.format}.`,
    context.market ? `Market: ${context.market}.` : "",
    context.propertyType ? `Property type: ${context.propertyType}.` : "",
    context.goal ? `Campaign goal: ${context.goal}.` : "",
    context.offer ? `Offer: ${context.offer}.` : "",
    context.headline ? `Overlay headline context: ${context.headline}.` : "",
    context.description ? `Overlay description context: ${context.description}.` : "",
    input.layoutBrief ? `Ad layout constraints: ${input.layoutBrief}.` : "",
    "Use the supplied reference photo as the real property.",
    "Preserve the actual architecture, facade, room structure, materials, windows, landscape, and setting.",
    "Extend only neutral edges or sky/walls/floor/garden where needed to fit the target ad frame.",
    "Improve lighting, sharpness, crop, perspective, and composition for a premium real-estate ad.",
    "Leave clean copy-safe space for overlaid ad text and CTA.",
    "Do not invent pools, views, rooms, staging, people, cars, signage, prices, logos, awards, ad text, or property features.",
  ].filter(Boolean).join("\n");
}

export function repairAssetMetadata(input: {
  sourceImage: string;
  targetFormat: AdStudioFormat;
  model: string;
  provider: string;
  contentType?: string | null;
}): Record<string, unknown> {
  return {
    generated: true,
    aiRepair: true,
    repairMode: REPAIR_MODE,
    sourceImage: input.sourceImage,
    targetFormat: input.targetFormat,
    model: input.model,
    provider: input.provider,
    contentType: input.contentType ?? null,
  };
}

export function repairStoragePath(input: {
  workspaceId: string;
  seed: string;
  format: AdStudioFormat;
  extension: string;
}): string {
  const formatSlug = input.format.replace(/[^0-9a-z]+/gi, "x");
  return `${input.workspaceId}/adstudio/repaired/${input.seed}-${formatSlug}.${input.extension}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
