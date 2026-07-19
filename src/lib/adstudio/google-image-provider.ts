import { dataUrlToUploadBytes } from "./generated-media.ts";
import { fetchProviderRequest, ProviderRequestError } from "./providers.ts";
import type {
  ImageProviderAdapter,
  ImageProviderRequest,
  ProviderAccountingContext,
} from "./providers.ts";

type EnvLike = Partial<Record<string, string>>;

type GoogleImageProviderOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  model?: string;
};

const GOOGLE_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export function createGoogleImageProvider(
  accounting: ProviderAccountingContext,
  options: GoogleImageProviderOptions = {},
): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? env.BLOCKWISE_GOOGLE_IMAGE_MODEL ?? "gemini-3.1-flash-image";

  return {
    providerName: "google",
    providerType: "image_generation",
    accounting,
    capabilities: { textToImage: true, imageToImage: true, multiReference: true },
    async generate(input) {
      const apiKey = env.GOOGLE_AI_API_KEY;
      if (!apiKey) {
        throw new ProviderRequestError("GOOGLE_AI_API_KEY is not configured.", {
          requestSubmitted: false,
          retryable: false,
        });
      }
      if (!input.referenceAssets.length) {
        throw new ProviderRequestError("Google image editing requires at least one reference image.", {
          requestSubmitted: false,
          retryable: false,
        });
      }

      const referenceParts = await Promise.all(
        input.referenceAssets.map((reference) => googleImageInput(reference, fetchImpl, input.signal)),
      );
      const prompt = input.negativePrompt
        ? `${input.prompt}\nAvoid: ${input.negativePrompt}.`
        : input.prompt;
      const response = await fetchProviderRequest(fetchImpl, GOOGLE_INTERACTIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          input: [...referenceParts, { type: "text", text: prompt }],
          response_format: {
            type: "image",
            mime_type: "image/jpeg",
            aspect_ratio: input.aspectRatio,
            image_size: "1K",
          },
        }),
        signal: input.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
        steps?: Array<{
          type?: string;
          content?: Array<{ type?: string; data?: string; mime_type?: string }>;
        }>;
      };
      if (!response.ok) {
        throw new ProviderRequestError(
          `Google image request failed (${response.status}): ${payload.error?.message ?? "Unknown error"}`,
          {
            requestSubmitted: true,
            retryable: isRetryableProviderStatus(response.status),
            providerRequestId: payload.id,
          },
        );
      }

      const image = payload.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .find((content) => content.type === "image" && content.data);
      if (!image?.data) {
        throw new ProviderRequestError("Google image response did not contain an image.", {
          requestSubmitted: true,
          retryable: false,
          providerRequestId: payload.id,
        });
      }

      return {
        assetUrl: `data:${image.mime_type ?? "image/jpeg"};base64,${image.data}`,
        seed: input.seed ?? 0,
        model,
        usage: { imageUnits: 1, complete: true },
        providerMetadata: {
          provider: "google",
          requestId: payload.id ?? null,
          referenceAssets: input.referenceAssets.length,
        },
      };
    },
  };
}

async function googleImageInput(reference: string, fetchImpl: typeof fetch, signal?: AbortSignal) {
  if (reference.startsWith("data:")) {
    const decoded = dataUrlToUploadBytes(reference);
    return {
      type: "image",
      data: Buffer.from(decoded.bytes).toString("base64"),
      mime_type: decoded.contentType,
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(reference, { signal });
  } catch (cause) {
    throw new ProviderRequestError("A Google reference image could not be fetched.", {
      requestSubmitted: false,
      retryable: false,
      cause,
    });
  }
  if (!response.ok) {
    throw new ProviderRequestError(`A Google reference image could not be fetched (${response.status}).`, {
      requestSubmitted: false,
      retryable: false,
    });
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  return {
    type: "image",
    data: Buffer.from(await response.arrayBuffer()).toString("base64"),
    mime_type: mimeType,
  };
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
