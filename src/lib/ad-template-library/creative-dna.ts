import { assembleSkeletonExtractionPrompt } from "../operator/prompts/assemble-prompt.ts";
import { getActivePromptBundle, type PromptBundle, type PromptKey } from "../operator/prompts/prompt-registry.ts";
import type { TextProviderAdapter, TextProviderResponse } from "../adstudio/providers.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "./skeleton.ts";

export const CREATIVE_DNA_VERSION = "creative-dna-v1";

export const SKELETON_PROMPT_KEYS: PromptKey[] = [
  "adstudio.skeleton.system",
  "adstudio.skeleton.input_template",
  "adstudio.skeleton.output_schema",
  "adstudio.skeleton.extraction_rules",
];

export type CreativeDnaObservedAd = {
  observedAdId: string;
  adCreativeId: string;
  imageUrl: string;
  headline?: string | null;
  body?: string | null;
  cta?: string | null;
  adType?: string | null;
  primaryIntent?: string | null;
  format?: string | null;
  advertiserName?: string | null;
};

export type CreativeSkeletonExtractionResult = {
  skeleton: CreativeSkeleton;
  rawText: string;
  promptVersions: Array<{ key: PromptKey; version: number; id: string | null; source: "db" | "fallback" }>;
  providerMetadata: Record<string, unknown>;
  usage: Record<string, number>;
};

export async function extractCreativeSkeletonForAd(input: {
  ad: CreativeDnaObservedAd;
  provider: TextProviderAdapter;
  bundle?: PromptBundle;
}): Promise<CreativeSkeletonExtractionResult> {
  const bundle = input.bundle ?? await getActivePromptBundle(SKELETON_PROMPT_KEYS);
  const prompt = assembleSkeletonExtractionPrompt({
    bundle,
    observedAd: {
      headline: input.ad.headline,
      body: input.ad.body,
      cta: input.ad.cta,
      adType: input.ad.adType,
      primaryIntent: input.ad.primaryIntent,
      format: input.ad.format,
      imageUrl: input.ad.imageUrl,
      advertiserName: input.ad.advertiserName,
    },
  });
  const response = await input.provider.generate({
    system: prompt.system,
    schemaName: "creativeSkeleton",
    imageUrl: input.ad.imageUrl,
    messages: [{ role: "user", content: prompt.user }],
  });

  return parseCreativeSkeletonResponse(response, prompt.promptVersions);
}

export type TemplateExtractionSource = "sample_import" | "ad_radar";

export type TemplateSampleAsset = {
  imageUrl: string;
  imageHash?: string;
  headline?: string | null;
  body?: string | null;
  cta?: string | null;
  adType?: string | null;
  primaryIntent?: string | null;
  format?: string | null;
  advertiserName?: string | null;
  observedAdId?: string;
  adCreativeId?: string;
};

export type TemplateExtractionResult = CreativeSkeletonExtractionResult & { source: TemplateExtractionSource };

/**
 * One extractor, two callers. The nightly miner passes a scraped winning ad
 * (source="ad_radar"); the operator template generator passes an uploaded sample
 * (source="sample_import"), which has no scrape copy — the vision model reads the
 * image. Both run the same registry-prompt creative-DNA teardown so mined and
 * sample-imported templates share one contract (image_frames + copy-safe zones +
 * classification).
 */
export async function extractTemplateFromImage(input: {
  asset: TemplateSampleAsset;
  source: TemplateExtractionSource;
  provider: TextProviderAdapter;
  bundle?: PromptBundle;
}): Promise<TemplateExtractionResult> {
  const id = input.asset.observedAdId ?? `${input.source}:${input.asset.imageHash ?? input.asset.imageUrl}`;
  const result = await extractCreativeSkeletonForAd({
    ad: {
      observedAdId: id,
      adCreativeId: input.asset.adCreativeId ?? id,
      imageUrl: input.asset.imageUrl,
      headline: input.asset.headline ?? null,
      body: input.asset.body ?? null,
      cta: input.asset.cta ?? null,
      adType: input.asset.adType ?? null,
      primaryIntent: input.asset.primaryIntent ?? null,
      format: input.asset.format ?? null,
      advertiserName: input.asset.advertiserName ?? null,
    },
    provider: input.provider,
    bundle: input.bundle,
  });
  return { ...result, source: input.source };
}

export function parseCreativeSkeletonResponse(
  response: TextProviderResponse,
  promptVersions: CreativeSkeletonExtractionResult["promptVersions"] = [],
): CreativeSkeletonExtractionResult {
  const parsed = creativeSkeletonSchema.safeParse(response.json);

  if (!parsed.success) {
    throw new Error(`Creative skeleton output failed schema validation: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return {
    skeleton: parsed.data,
    rawText: response.rawText,
    promptVersions,
    providerMetadata: response.providerMetadata,
    usage: response.usage,
  };
}
