import type {
  ModelCandidate,
} from "@/lib/ai/model-registry";

import { dataUrlToUploadBytes } from "./generated-media.ts";
import { createGoogleImageProvider } from "./google-image-provider.ts";
import { fetchProviderRequest, ProviderRequestError } from "./providers.ts";
import type {
  ImageProviderAdapter,
  ImageProviderRequest,
  ImageProviderResponse,
  ProviderAccountingContext,
  ProviderUsage,
  TextProviderAdapter,
  TextProviderRequest,
  TextProviderResponse,
} from "./providers.ts";

type EnvLike = Partial<Record<string, string>>;

type ProviderOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  model?: string;
  /** OpenAI image quality tier ("low" | "medium" | "high" | "auto"). */
  quality?: string;
};

// Hard cap on completion tokens for copy/QA chat calls. Outputs are small
// JSON packs; this bounds worst-case spend per call and keeps requests viable
// on low OpenRouter balances (it reserves credits against the requested max).
const MAX_COMPLETION_TOKENS = 4096;

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/images";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const AZURE_OPENAI_DEFAULT_API_VERSION = "2024-10-21";
// best now, cost-tune later — gpt-image-2 processes inputs at max fidelity regardless.
const DEFAULT_OPENAI_IMAGE_QUALITY = "high";

function createOpenRouterTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENROUTER_TEXT_MODEL ?? "openai/gpt-5.5";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openrouter",
    providerType: "text_generation",
    capabilities: {
      structuredJson: true,
      longContext: true,
      toolCalling: true,
      visionInput: true,
    },
    async generate(input) {
      const apiKey = env.OPENROUTER_API_KEY;

      if (!apiKey) {
        throw preflightError("OPENROUTER_API_KEY is not configured.");
      }

      return postChatCompletion({
        url: OPENROUTER_CHAT_URL,
        apiKey,
        model,
        input,
        fetchImpl,
        headers: {
          "HTTP-Referer": env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title": "Blockwise",
        },
      });
    },
  };
}

function createOpenAiTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENAI_TEXT_MODEL ?? "gpt-5.5";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openai",
    providerType: "text_generation",
    capabilities: {
      structuredJson: true,
      longContext: true,
      visionInput: true,
    },
    async generate(input) {
      const apiKey = env.OPENAI_API_KEY;

      if (!apiKey) {
        throw preflightError("OPENAI_API_KEY is not configured.");
      }

      return postChatCompletion({
        url: env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_CHAT_URL,
        apiKey,
        model,
        input,
        fetchImpl,
        headers: gatewayHeaders(env),
      });
    },
  };
}

function createAzureOpenAiTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
  const env = options.env ?? process.env;
  const deployment =
    options.model ??
    env.AZURE_OPENAI_DEPLOYMENT ??
    env.AZURE_OPENAI_CHAT_DEPLOYMENT ??
    env.AZURE_OPENAI_TEXT_DEPLOYMENT ??
    env.BLOCKWISE_AZURE_OPENAI_TEXT_DEPLOYMENT ??
    "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "azure",
    providerType: "text_generation",
    capabilities: {
      structuredJson: true,
      longContext: true,
      visionInput: true,
    },
    async generate(input) {
      const apiKey = env.AZURE_OPENAI_API_KEY;

      if (!apiKey) {
        throw preflightError("AZURE_OPENAI_API_KEY is not configured.");
      }
      if (!deployment && !env.AZURE_OPENAI_CHAT_COMPLETIONS_URL) {
        throw preflightError("AZURE_OPENAI_DEPLOYMENT is not configured.");
      }

      return postChatCompletion({
        url: resolveAzureOpenAiChatUrl(env, deployment),
        apiKey,
        model: deployment || "azure-openai",
        input,
        fetchImpl,
        headers: {
          "api-key": apiKey,
        },
        authHeader: false,
        includeModelInBody: false,
      });
    },
  };
}

export function resolveAzureOpenAiChatUrl(env: EnvLike, deployment: string): string {
  if (env.AZURE_OPENAI_CHAT_COMPLETIONS_URL) return env.AZURE_OPENAI_CHAT_COMPLETIONS_URL;

  const endpoint = env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/u, "");
  if (!endpoint) {
    throw new Error("AZURE_OPENAI_ENDPOINT is not configured.");
  }
  if (!deployment) {
    throw new Error("AZURE_OPENAI_DEPLOYMENT is not configured.");
  }

  const apiVersion = env.AZURE_OPENAI_API_VERSION ?? AZURE_OPENAI_DEFAULT_API_VERSION;
  return `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function createOpenAiImageProvider(options: ProviderOptions = {}): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const quality = options.quality ?? env.BLOCKWISE_OPENAI_IMAGE_QUALITY ?? DEFAULT_OPENAI_IMAGE_QUALITY;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openai",
    providerType: "image_generation",
    // gpt-image-2's /images/edits consumes one or more reference images plus an
    // optional mask, so it satisfies the truth-preserving repair gate
    // (imageToImage && multiReference) — see supportsTruthPreservingRepair.
    capabilities: {
      textToImage: true,
      imageToImage: true,
      inpainting: true,
      multiReference: true,
    },
    async generate(input) {
      const apiKey = env.OPENAI_API_KEY;

      if (!apiKey) {
        throw preflightError("OPENAI_API_KEY is not configured.");
      }


      // Reference-based fit/extend → /images/edits (multipart). Otherwise the
      // text-to-image /images/generations path (JSON), unchanged.
      const response = input.requiresReferenceAssets
        ? await postOpenAiImageEdit({ env, apiKey, model, quality, input, fetchImpl })
        : await fetchProviderRequest(fetchImpl, env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_IMAGE_URL, {
            method: "POST",
            signal: input.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              ...gatewayHeaders(env),
            },
            body: JSON.stringify({
              model,
              prompt: buildImagePrompt(input),
              size: imageSizeForAspect(input.aspectRatio),
              quality,
              n: 1,
            }),
          });

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        data?: Array<{ url?: string; b64_json?: string }>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
        };
        error?: { message?: string };
      };

      if (!response.ok) {
        throw submittedHttpError(payload.error?.message ?? `Provider image request failed with ${response.status}.`, response.status, {
          providerRequestId: payload.id,
          usage: usageFromProviderPayload(payload.usage, { imageUnits: 0, complete: false }),
        });
      }

      const first = payload.data?.[0];
      const assetUrl = first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);
      if (!assetUrl) {
        throw submittedError("OpenAI returned no image.", {
          retryable: false,
          providerRequestId: payload.id,
          usage: usageFromProviderPayload(payload.usage, {
            imageUnits: 0,
            providerRequestId: payload.id,
            complete: true,
          }),
        });
      }

      return {
        assetUrl,
        seed: input.seed ?? 0,
        model,
        usage: usageFromProviderPayload(payload.usage, {
          imageUnits: 1,
          providerRequestId: payload.id,
          complete: true,
        }),
        providerMetadata: {
          provider: "openai",
          referenceAssets: input.referenceAssets.length,
          mode: input.requiresReferenceAssets ? "edit" : "generation",
        },
      };
    },
  };
}

/** Resolves the /images/edits endpoint, honouring a Cloudflare AI Gateway URL. */
export function resolveOpenAiImageEditsUrl(env: EnvLike): string {
  const gateway = env.CLOUDFLARE_AI_GATEWAY_URL;
  if (!gateway) return OPENAI_IMAGE_EDITS_URL;
  // A real gateway mirrors the OpenAI path (…/openai/images/generations); swap the
  // trailing endpoint to edits. If the URL doesn't expose that segment, use it
  // verbatim — same best-effort posture as the generations path.
  if (gateway.includes("/images/generations")) {
    return gateway.replace("/images/generations", "/images/edits");
  }
  if (/\/generations\/?$/.test(gateway)) {
    return gateway.replace(/\/generations(\/?)$/, "/edits$1");
  }
  return gateway;
}

async function postOpenAiImageEdit(input: {
  env: EnvLike;
  apiKey: string;
  model: string;
  quality: string;
  input: ImageProviderRequest;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  const references = input.input.referenceAssets;
  if (!references.length) {
    throw preflightError("Reference-image edit requires at least one image.");
  }

  const blobs: Blob[] = [];
  let maskBlob: Blob | null = null;
  try {
    for (const reference of references) {
      blobs.push(await imageReferenceToBlob(reference, input.fetchImpl, input.input.signal));
    }
    maskBlob = input.input.maskImage
      ? await imageReferenceToBlob(input.input.maskImage, input.fetchImpl, input.input.signal)
      : null;
  } catch (cause) {
    throw new ProviderRequestError("Reference image could not be prepared for provider dispatch.", {
      requestSubmitted: false,
      retryable: false,
      cause,
    });
  }

  const send = (size: string) => {
    const form = new FormData();
    form.set("model", input.model);
    form.set("prompt", buildImagePrompt(input.input, { includeReferenceList: false }));
    form.set("size", size);
    form.set("quality", input.quality);
    form.set("n", "1");
    const single = blobs.length === 1;
    blobs.forEach((blob, index) => {
      // Single reference uses `image`; multiple uses `image[]` per the API contract.
      form.append(single ? "image" : "image[]", blob, `reference-${index}.png`);
    });
    if (maskBlob) form.set("mask", maskBlob, "mask.png");
    // No explicit Content-Type — fetch sets the multipart boundary itself.
    return fetchProviderRequest(input.fetchImpl, resolveOpenAiImageEditsUrl(input.env), {
      method: "POST",
      signal: input.input.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...gatewayHeaders(input.env),
      },
      body: form,
    });
  };

  return send(imageSizeForAspect(input.input.aspectRatio));

  // Supported size sets differ per model generation (e.g. gpt-image-1-mini
  // rejects 1024x1280 while gpt-image-2 accepts it). On that specific error,
  // retry once with "auto" — the model picks the nearest size to the inputs.
}

// Resolves a reference (data: URL or http(s) URL) to a Blob for multipart upload.
async function imageReferenceToBlob(reference: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Blob> {
  if (reference.startsWith("data:")) {
    const decoded = dataUrlToUploadBytes(reference);
    // Copy into a fresh ArrayBuffer-backed view so it satisfies BlobPart.
    const bytes = new Uint8Array(decoded.bytes.byteLength);
    bytes.set(decoded.bytes);
    return new Blob([bytes], { type: decoded.contentType });
  }
  const response = await fetchImpl(reference, { signal });
  if (!response.ok) {
    throw new Error(`Reference image could not be fetched (${response.status}).`);
  }
  return response.blob();
}

// Google AI Studio direct (free-tier keys, no card): Gemini through Google's
// OpenAI-compatible endpoint, so the standard chat-completion path applies.
const GOOGLE_AI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function createGoogleAiTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_GOOGLE_TEXT_MODEL ?? "gemini-2.5-flash";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "google",
    providerType: "text_generation",
    capabilities: { structuredJson: true, visionInput: true },
    async generate(input) {
      const apiKey = env.GOOGLE_AI_API_KEY;
      if (!apiKey) throw preflightError("GOOGLE_AI_API_KEY is not configured.");
      return postChatCompletion({ url: GOOGLE_AI_CHAT_URL, apiKey, model, input, fetchImpl });
    },
  };
}

function createOpenRouterImageProvider(options: ProviderOptions = {}): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENROUTER_IMAGE_MODEL ?? "google/gemini-3.1-flash-image-preview";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openrouter",
    providerType: "image_generation",
    capabilities: {
      textToImage: true,
      imageToImage: true,
      multiReference: true,
    },
    async generate(input) {
      const apiKey = env.OPENROUTER_API_KEY;

      if (!apiKey) {
        throw preflightError("OPENROUTER_API_KEY is not configured.");
      }
      if (input.requiresReferenceAssets && input.referenceAssets.length === 0) {
        throw preflightError("Reference-image repair requires at least one image.");
      }

      const response = await fetchProviderRequest(fetchImpl, OPENROUTER_IMAGE_URL, {
        method: "POST",
        signal: input.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title": "Blockwise",
        },
        body: JSON.stringify({
          model,
          prompt: buildImagePrompt(input, { includeReferenceList: false }),
          n: 1,
          aspect_ratio: input.aspectRatio,
          quality: options.quality ?? DEFAULT_OPENAI_IMAGE_QUALITY,
          output_format: "png",
          seed: input.seed,
          input_references: input.referenceAssets.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        data?: Array<{ b64_json?: string; media_type?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string };
      };
      const providerRequestId = payload.id ?? response.headers.get("x-request-id") ?? undefined;

      if (!response.ok) {
        throw submittedHttpError(payload.error?.message ?? `OpenRouter image request failed with ${response.status}.`, response.status, {
          providerRequestId,
          usage: usageFromProviderPayload(payload.usage, { imageUnits: 0, complete: false }),
        });
      }

      const image = payload.data?.[0];
      if (!image?.b64_json) {
        throw submittedError("OpenRouter returned no image.", {
          retryable: false,
          providerRequestId,
          usage: usageFromProviderPayload(payload.usage, {
            imageUnits: 0,
            providerRequestId,
            complete: true,
          }),
        });
      }
      const assetUrl = `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`;

      return {
        assetUrl,
        seed: input.seed ?? 0,
        model,
        usage: usageFromProviderPayload(payload.usage, {
          imageUnits: 1,
          providerRequestId,
          complete: true,
        }),
        providerMetadata: {
          provider: "openrouter",
          referenceAssets: input.referenceAssets.length,
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

export function createTextProviderForCandidate(candidate: ModelCandidate, options: ProviderOptions = {}): TextProviderAdapter {
  let provider: TextProviderAdapter;
  if (candidate.provider === "openrouter") {
    provider = createOpenRouterTextProvider({ ...options, model: candidate.model });
  } else if (candidate.provider === "azure") {
    provider = createAzureOpenAiTextProvider({ ...options, model: candidate.model });
  } else if (candidate.provider === "google") {
    provider = createGoogleAiTextProvider({ ...options, model: candidate.model });
  } else {
    provider = createOpenAiTextProvider({ ...options, model: candidate.model });
  }
  return withAccounting(provider, candidate);
}

export function createImageProviderForCandidate(candidate: ModelCandidate, options: ProviderOptions = {}): ImageProviderAdapter {
  let provider: ImageProviderAdapter;
  if (candidate.provider === "openrouter") {
    provider = createOpenRouterImageProvider({ ...options, model: candidate.model });
  } else if (candidate.provider === "google") {
    provider = createGoogleImageProvider(accountingForCandidate(candidate), { ...options, model: candidate.model });
  } else {
    provider = createOpenAiImageProvider({ ...options, model: candidate.model });
  }
  return withAccounting(provider, candidate);
}

async function postChatCompletion(input: {
  url: string;
  apiKey: string;
  model: string;
  input: TextProviderRequest;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
  authHeader?: boolean;
  includeModelInBody?: boolean;
}): Promise<TextProviderResponse> {
  const includeModelInBody = input.includeModelInBody ?? true;
  const response = await fetchProviderRequest(input.fetchImpl, input.url, {
    method: "POST",
    headers: {
      ...(input.authHeader === false ? {} : { Authorization: `Bearer ${input.apiKey}` }),
      "Content-Type": "application/json",
      ...input.headers,
    },
    body: JSON.stringify({
      ...(includeModelInBody ? { model: input.model } : {}),
      messages: buildChatMessages(input.input),
      response_format: { type: "json_object" },
      // Reasoning models (gpt-5*, o*) accept only the default temperature and
      // reject the request outright when any other value is sent.
      ...(supportsCustomTemperature(input.model) ? { temperature: 0.4 } : {}),
      // Without an explicit cap, OpenRouter reserves credits for the model's
      // absolute max completion (65k+ tokens) — requests fail on low balances
      // and a bad loop can drain the account. Copy/QA outputs are small JSON;
      // 4096 is generous. Reasoning models only accept max_completion_tokens.
      ...(supportsCustomTemperature(input.model)
        ? { max_tokens: MAX_COMPLETION_TOKENS }
        : { max_completion_tokens: MAX_COMPLETION_TOKENS }),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw submittedHttpError(payload.error?.message ?? `Provider request failed with ${response.status}.`, response.status, {
      providerRequestId: payload.id,
      usage: usageFromProviderPayload(payload.usage, { complete: false }),
    });
  }

  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "{}";

  return {
    json: parseJson(rawText),
    rawText,
    usage: usageFromProviderPayload(payload.usage, {
      providerRequestId: payload.id,
      complete: true,
    }),
    providerMetadata: {
      model: input.model,
      schemaName: input.input.schemaName,
    },
  };
}

function withAccounting<T extends TextProviderAdapter | ImageProviderAdapter>(
  provider: T,
  candidate: ModelCandidate,
): T {
  return { ...provider, accounting: accountingForCandidate(candidate) };
}

function accountingForCandidate(candidate: ModelCandidate): ProviderAccountingContext {
  if (!candidate.model.trim()) {
    throw new Error("A priced provider candidate must declare a model.");
  }
  for (const [field, value] of Object.entries({
    inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
    imageUsdPerUnit: candidate.imageUsdPerUnit,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`A priced provider candidate requires a non-negative ${field}.`);
    }
  }

  return {
    model: candidate.model,
    modelProfileVersionId: candidate.modelProfileVersionId ?? null,
    pricingSnapshotId: candidate.pricingSnapshotId ?? null,
    pricing: {
      inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
      imageUsdPerUnit: candidate.imageUsdPerUnit,
      currency: "USD",
      inputTokenBasis: "per_million_tokens",
      outputTokenBasis: "per_million_tokens",
      imageBasis: "per_output_image",
      source: candidate.pricingSource ?? "default",
      snapshotId: candidate.pricingSnapshotId ?? null,
    },
  };

}

function usageFromProviderPayload(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  } | undefined,
  defaults: ProviderUsage,
): ProviderUsage {
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
  const hasCompleteTokenUsage = Number.isFinite(inputTokens) && Number.isFinite(outputTokens);
  return {
    ...defaults,
    ...(Number.isFinite(inputTokens) ? { inputTokens: Number(inputTokens) } : {}),
    ...(Number.isFinite(outputTokens) ? { outputTokens: Number(outputTokens) } : {}),
    complete: defaults.complete === true && hasCompleteTokenUsage,
    ...(Number.isFinite(usage?.cost) ? { actualCostUsd: Number(usage?.cost) } : {}),
  };
}

function preflightError(message: string): ProviderRequestError {
  return new ProviderRequestError(message, { requestSubmitted: false, retryable: false });
}

function submittedError(
  message: string,
  options: {
    retryable: boolean;
    usage?: ProviderUsage;
    providerRequestId?: string | null;
    cause?: unknown;
  },
): ProviderRequestError {
  return new ProviderRequestError(message, { requestSubmitted: true, ...options });
}

function submittedHttpError(
  message: string,
  status: number,
  options: {
    usage?: ProviderUsage;
    providerRequestId?: string | null;
    cause?: unknown;
  } = {},
): ProviderRequestError {
  return submittedError(message, {
    ...options,
    retryable: isRetryableProviderStatus(status),
  });
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function supportsCustomTemperature(model: string): boolean {
  const name = model.split("/").pop() ?? model;
  return !/^(gpt-5|o\d)/i.test(name);
}

// Builds the chat payload. When an image is supplied, it is attached to the final
// user message as a multimodal content array accepted by supported vision providers.
function buildChatMessages(request: TextProviderRequest): unknown[] {
  const system = { role: "system", content: request.system };

  if (!request.imageUrl) {
    return [system, ...request.messages];
  }

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = request.messages.map(
    (message) => ({ role: message.role, content: message.content }),
  );
  const imagePart = { type: "image_url", image_url: { url: request.imageUrl } };

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex >= 0) {
    messages[lastUserIndex] = {
      role: "user",
      content: [{ type: "text", text: String(messages[lastUserIndex].content) }, imagePart],
    };
  } else {
    messages.push({ role: "user", content: [imagePart] });
  }

  return [system, ...messages];
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    // Models frequently fence JSON in markdown or preface it with prose.
    // Extract the outermost JSON object before
    // giving up — rejecting good content cost a whole provider lane.
    const unfenced = rawText.replace(/```(?:json)?/gi, "");
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error("Provider returned non-JSON content.");
  }
}

function gatewayHeaders(env: EnvLike): Record<string, string> {
  return env.CLOUDFLARE_AI_GATEWAY_TOKEN
    ? { "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}` }
    : {};
}

function buildImagePrompt(
  input: ImageProviderRequest,
  options: { includeReferenceList?: boolean } = {},
): string {
  const includeReferenceList = options.includeReferenceList ?? true;
  return [
    input.prompt,
    `Aspect ratio: ${input.aspectRatio}.`,
    `Style preset: ${input.stylePreset}.`,
    input.negativePrompt ? `Avoid: ${input.negativePrompt}.` : "",
    includeReferenceList && input.referenceAssets.length
      ? `Reference assets: ${input.referenceAssets.join(", ")}.`
      : "",
  ].filter(Boolean).join("\n");
}

function extractImageUrl(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/)?.[0];
  }

  if (!Array.isArray(content)) return undefined;

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url === "string" && record.url.startsWith("data:image/")) return record.url;
    const imageUrl = record.image_url;
    if (imageUrl && typeof imageUrl === "object") {
      const url = (imageUrl as Record<string, unknown>).url;
      if (typeof url === "string" && url.startsWith("data:image/")) return url;
    }
  }

  return undefined;
}

function imageSizeForAspect(aspectRatio: string): string {
  // OpenAI's image endpoints accept only these native canvases. AdStudio's
  // exact placement ratio remains in the prompt and the clone pipeline crops
  // the returned native canvas to that ratio before QA and persistence.
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "1.91:1") return "1536x1024";
  return "1024x1536";
}
