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

import { fetchProviderRequest, ProviderRequestError } from "./providers.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse, ProviderAccountingContext, ProviderUsage } from "./providers.ts";

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

export function createFalImageProvider(
  accounting: ProviderAccountingContext,
  options: FalProviderOptions = {},
): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_FAL_IMAGE_MODEL ?? "openai/gpt-image-2/edit";
  const quality = options.quality ?? env.BLOCKWISE_FAL_IMAGE_QUALITY ?? "high";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 110_000;
  const pollMs = options.pollMs ?? 2_500;
  const isGeminiEdit = /gemini/i.test(model);

  return {
    providerName: "fal",
    providerType: "image_generation",
    accounting,
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate(input: ImageProviderRequest): Promise<ImageProviderResponse> {
      const key = env.FAL_KEY ?? env.FAL_API_KEY;
      if (!key) {
        throw new ProviderRequestError("FAL_KEY is not configured.", {
          requestSubmitted: false,
          retryable: false,
        });
      }
      if (!input.referenceAssets.length) {
        throw new ProviderRequestError("fal image edit requires at least one reference image.", {
          requestSubmitted: false,
          retryable: false,
        });
      }

      const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
      const body = JSON.stringify({
        prompt: buildFalPrompt(input),
        image_urls: input.referenceAssets,
        ...(isGeminiEdit
          ? {
              aspect_ratio: input.aspectRatio,
              resolution: "1K",
              limit_generations: true,
            }
          : {
              image_size: falImageSizeForAspect(input.aspectRatio),
              quality,
            }),
        num_images: 1,
        output_format: "png",
        sync_mode: true,
        seed: input.seed,
      });

      const submit = await fetchProviderRequest(fetchImpl, `${FAL_QUEUE_BASE}/${model}`, {
        method: "POST",
        headers,
        body,
        signal: input.signal,
      });
      const submitJson = (await submit.json().catch(() => ({}))) as {
        request_id?: string;
        status_url?: string;
        response_url?: string;
        detail?: unknown;
      };
      if (!submit.ok || !submitJson.status_url || !submitJson.response_url) {
        const submitDetail = JSON.stringify(submitJson.detail ?? submitJson).slice(0, 300);
        throw new ProviderRequestError(
          `fal submit failed (${submit.status}): ${submitDetail}`,
          {
            requestSubmitted: true,
            retryable: isRetryableProviderStatus(submit.status)
              || isFalBillingUnavailable(submit.status, submitDetail),
            providerRequestId: submitJson.request_id,
          },
        );
      }

      const deadline = Date.now() + timeoutMs;
      // Poll until COMPLETED (or failure / timeout).
      for (;;) {
        if (Date.now() > deadline) {
          throw new ProviderRequestError("fal generation timed out.", {
            requestSubmitted: true,
            retryable: true,
            providerRequestId: submitJson.request_id,
          });
        }
        await new Promise((r) => setTimeout(r, pollMs));
        const statusRes = await fetchProviderRequest(
          fetchImpl,
          submitJson.status_url,
          { headers, signal: input.signal },
          { providerRequestId: submitJson.request_id },
        );
        const statusJson = (await statusRes.json().catch(() => ({}))) as { status?: string };
        if (!statusRes.ok) {
          throw new ProviderRequestError(`fal status request failed (${statusRes.status}).`, {
            requestSubmitted: true,
            retryable: isRetryableProviderStatus(statusRes.status),
            providerRequestId: submitJson.request_id,
          });
        }
        if (statusJson.status === "COMPLETED") break;
        if (!statusJson.status) {
          throw new ProviderRequestError("fal status response did not include a status.", {
            requestSubmitted: true,
            retryable: false,
            providerRequestId: submitJson.request_id,
          });
        }
        if (statusJson.status && !["IN_QUEUE", "IN_PROGRESS"].includes(statusJson.status)) {
          throw new ProviderRequestError(`fal status ${statusJson.status}`, {
            requestSubmitted: true,
            retryable: false,
            providerRequestId: submitJson.request_id,
          });
        }
      }

      const result = await fetchProviderRequest(
        fetchImpl,
        submitJson.response_url,
        { headers, signal: input.signal },
        { providerRequestId: submitJson.request_id },
      );
      const resultJson = (await result.json().catch(() => ({}))) as {
        images?: Array<{ url?: string }>;
        cost?: number;
        usage?: { cost?: number };
        detail?: unknown;
      };
      const resultCost = resultJson.cost ?? resultJson.usage?.cost;
      if (!result.ok) {
        throw new ProviderRequestError(
          `fal result request failed (${result.status}): ${JSON.stringify(resultJson.detail ?? resultJson).slice(0, 300)}`,
          {
            requestSubmitted: true,
            retryable: isRetryableProviderStatus(result.status),
            providerRequestId: submitJson.request_id,
            usage: {
              imageUnits: 0,
              providerRequestId: submitJson.request_id,
              complete: false,
              ...(Number.isFinite(resultCost) ? { actualCostUsd: Number(resultCost) } : {}),
            },
          },
        );
      }
      const assetUrl = resultJson.images?.[0]?.url ?? "";
      if (!assetUrl) {
        throw new ProviderRequestError("fal returned no image.", {
          requestSubmitted: true,
          retryable: false,
          providerRequestId: submitJson.request_id,
          usage: {
            imageUnits: 0,
            providerRequestId: submitJson.request_id,
            complete: false,
            ...(Number.isFinite(resultCost) ? { actualCostUsd: Number(resultCost) } : {}),
          },
        });
      }

      const usage: ProviderUsage = {
        imageUnits: 1,
        providerRequestId: submitJson.request_id,
        complete: true,
        ...(Number.isFinite(resultCost) ? { actualCostUsd: Number(resultCost) } : {}),
      };

      return {
        assetUrl,
        seed: input.seed ?? 0,
        model,
        usage,
        providerMetadata: { provider: "fal", requestId: submitJson.request_id ?? null, referenceAssets: input.referenceAssets.length },
      };
    },
  };
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isFalBillingUnavailable(status: number, detail: string): boolean {
  return (status === 402 || status === 403)
    && /exhausted balance|insufficient (?:funds|balance)|billing quota/i.test(detail);
}
