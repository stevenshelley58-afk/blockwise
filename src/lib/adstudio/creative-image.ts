import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";

import { createImageProviderForCandidate, createOpenAiImageProvider } from "./ai-providers.ts";
import type { ImageProviderRequest } from "./providers.ts";

export type TemplateCreativeBrand = { businessName: string; primary: string; accent: string };
export type TemplateCreativeCopy = { headline: string; primaryText: string; cta: string };

/**
 * Build the prompt for a finished, on-brand ad creative. The chosen template's
 * mined design recipe drives the layout/mood, the agent's photo is the hero, and
 * the exact campaign copy is baked in as legible on-image text — so the result is
 * a real Meta/Instagram ad that matches the template the agent picked.
 */
export function buildTemplateCreativePrompt(input: {
  designSeed?: string;
  brand: TemplateCreativeBrand;
  copy: TemplateCreativeCopy;
}): string {
  const { brand, copy, designSeed } = input;
  return [
    "Design one polished, professional real-estate social media ad creative for the Australian market that looks like a real, finished Instagram/Facebook ad.",
    `Agency: ${brand.businessName}. Brand colours: primary ${brand.primary}, accent ${brand.accent}. Modern, trustworthy, premium-but-local with clean sans-serif type.`,
    "Use the supplied property photo as the hero image of the ad. Keep it realistic and Australian; do not invent a different property.",
    designSeed ? `Creative direction (layout, imagery, mood):\n${designSeed}` : "",
    "Render this exact on-image copy, correctly spelled and clearly legible:",
    `- Headline: "${copy.headline}"`,
    copy.primaryText ? `- Supporting line: "${copy.primaryText}"` : "",
    copy.cta ? `- Call-to-action button: "${copy.cta}"` : "",
    "Compose like a finished ad: strong focal hierarchy, balanced negative space, and a clear call-to-action button. Never add fake, scrambled, duplicated or misspelled text, watermarks, or other brand logos.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Generate one creative, trying the runtime image-model profile's candidates in
 * order (e.g. gpt-image / gemini-flash-image), then the env default as a last
 * resort. Returns null only if every provider fails.
 */
export async function generateTemplateCreativeImage(
  input: ImageProviderRequest,
): Promise<{ assetUrl: string; model: string } | null> {
  const profile = await resolveRuntimeModelProfile("image_final");
  for (const candidate of modelCandidateAttempts(profile)) {
    try {
      const provider = createImageProviderForCandidate(candidate);
      const result = await provider.generate(input);
      if (result.assetUrl) return { assetUrl: result.assetUrl, model: result.model };
    } catch {
      // Try the next candidate.
    }
  }
  try {
    const result = await createOpenAiImageProvider().generate(input);
    if (result.assetUrl) return { assetUrl: result.assetUrl, model: result.model };
  } catch {
    // Fall through to null.
  }
  return null;
}
