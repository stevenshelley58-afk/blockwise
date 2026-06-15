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
