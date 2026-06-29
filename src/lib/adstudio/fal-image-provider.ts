// fal.ai image provider for AdStudio — hosted OpenAI gpt-image-2 edit, billed to
// fal (so it is independent of the OpenAI account's own billing limits).
//
// Implements the same ImageProviderAdapter contract as the OpenAI/OpenRouter
// providers in ai-providers.ts. Uses fal's queue API (submit -> poll -> result)
// which is robust for the ~60-90s gpt-image-2 edits. The request's
// referenceAssets become fal `image_urls` (reference image 1 = the design to
// clone, then the customer photo[s]); data: URIs and public URLs both work.
//
// Proven against fal `openai/gpt-image-2/edit`.

import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";

type EnvLike = Partial<Record<string, string>>;

type FalProviderOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  model?: string;
  quality?: string;
  /** Max time to wait for the queued job before giving up (ms). */
  timeoutMs?: number;
  /** Poll interval (ms). */
  pollMs?: number;
};

const FAL_QUEUE_BASE = "https://queue.fal.run";

/** Map an aspect ratio to a fal image_size (multiples of 16, <= 3:1, within pixel bounds). */
export function falImageSizeForAspect(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 768, height: 1344 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:5":
    default:
      return { width: 1024, height: 1280 };
  }
}

function buildFalPrompt(input: ImageProviderRequest): string {
  return input.negativePrompt ? `${input.prompt}\nAvoid: ${input.negativePrompt}.` : input.prompt;
}

export function createFalImageProvider(options: FalProviderOptions = {}): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_FAL_IMAGE_MODEL ?? "openai/gpt-image-2/edit";
  const quality = options.quality ?? env.BLOCKWISE_FAL_IMAGE_QUALITY ?? "high";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 110_000;
  const pollMs = options.pollMs ?? 2_500;

  return {
    providerName: "fal",
    providerType: "image_generation",
    capabilities: { textToImage: true, imageToImage: true, inpainting: true, multiReference: true },
    async generate(input: ImageProviderRequest): Promise<ImageProviderResponse> {
      const key = env.FAL_KEY ?? env.FAL_API_KEY;
      if (!key) throw new Error("FAL_KEY is not configured.");
      if (!input.referenceAssets.length) throw new Error("fal image edit requires at least one reference image.");

      const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
      const body = JSON.stringify({
        prompt: buildFalPrompt(input),
        image_urls: input.referenceAssets,
        image_size: falImageSizeForAspect(input.aspectRatio),
        mask_url: input.maskImage || undefined,
        quality,
        num_images: 1,
        output_format: "png",
        sync_mode: true,
      });

      const submit = await fetchImpl(`${FAL_QUEUE_BASE}/${model}`, { method: "POST", headers, body, signal: input.signal });
      const submitJson = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string; detail?: unknown };
      if (!submit.ok || !submitJson.status_url || !submitJson.response_url) {
        throw new Error(`fal submit failed (${submit.status}): ${JSON.stringify(submitJson.detail ?? submitJson).slice(0, 300)}`);
      }

      const deadline = Date.now() + timeoutMs;
      // Poll until COMPLETED (or failure / timeout).
      for (;;) {
        if (Date.now() > deadline) throw new Error("fal generation timed out.");
        await new Promise((r) => setTimeout(r, pollMs));
        const statusRes = await fetchImpl(submitJson.status_url, { headers, signal: input.signal });
        const statusJson = (await statusRes.json()) as { status?: string };
        if (statusJson.status === "COMPLETED") break;
        if (statusJson.status && !["IN_QUEUE", "IN_PROGRESS"].includes(statusJson.status)) {
          throw new Error(`fal status ${statusJson.status}`);
        }
      }

      const result = await fetchImpl(submitJson.response_url, { headers, signal: input.signal });
      const resultJson = (await result.json()) as { images?: Array<{ url?: string }> };
      const assetUrl = resultJson.images?.[0]?.url ?? "";
      if (!assetUrl) throw new Error("fal returned no image.");

      return {
        assetUrl,
        seed: input.seed ?? 0,
        model,
        providerMetadata: { provider: "fal", requestId: submitJson.request_id ?? null, referenceAssets: input.referenceAssets.length },
      };
    },
  };
}
