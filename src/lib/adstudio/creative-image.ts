import { createOpenAiImageProvider, createOpenRouterImageProvider } from "./ai-providers.ts";
import type { ImageProviderAdapter, ImageProviderRequest } from "./providers.ts";

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
 * A fetch wrapper that aborts after `ms`, so a slow/hung image provider can't run
 * the serverless function into a platform timeout (504).
 */
function fetchWithTimeout(ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(input, { ...(init ?? {}), signal: controller.signal }).finally(() => clearTimeout(timer));
  }) as typeof fetch;
}

/**
 * Generate one creative within a strict time budget. Prefer the multimodal
 * provider (OpenRouter / gemini), which takes the agent's photo as a real image
 * input; fall back to OpenAI gpt-image (text-to-image, medium quality for speed).
 * Only providers whose key is configured are attempted, and each call is bounded
 * so the function returns before the platform kills it. Throws a descriptive
 * error so the caller can log and surface why generation failed.
 */
export async function generateTemplateCreativeImage(
  input: ImageProviderRequest,
): Promise<{ assetUrl: string; model: string }> {
  const BUDGET_MS = 55_000;
  const start = Date.now();
  const errors: string[] = [];

  const attempts: Array<{ name: string; make: (fetchImpl: typeof fetch) => ImageProviderAdapter }> = [];
  if (process.env.OPENROUTER_API_KEY) {
    attempts.push({ name: "openrouter", make: (fetchImpl) => createOpenRouterImageProvider({ fetchImpl }) });
  }
  if (process.env.OPENAI_API_KEY) {
    attempts.push({ name: "openai", make: (fetchImpl) => createOpenAiImageProvider({ fetchImpl, quality: "medium" }) });
  }
  if (attempts.length === 0) {
    throw new Error("Image generation failed — no image provider key is configured (OPENROUTER_API_KEY / OPENAI_API_KEY).");
  }

  for (const { name, make } of attempts) {
    const remaining = BUDGET_MS - (Date.now() - start);
    if (remaining < 8_000) break; // not enough time left for a real attempt
    try {
      const provider = make(fetchWithTimeout(remaining));
      const result = await provider.generate(input);
      if (result.assetUrl) return { assetUrl: result.assetUrl, model: result.model };
      errors.push(`${name}: empty result`);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Image generation failed — ${errors.join(" | ") || "timed out"}`);
}
