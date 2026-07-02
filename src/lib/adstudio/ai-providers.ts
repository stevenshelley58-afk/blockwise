import type {
  ModelCandidate,
} from "@/lib/ai/model-registry";

import { dataUrlToUploadBytes } from "./generated-media.ts";
import { formatImageSize, outpaintTargetForAspect } from "./outpaint-layout.ts";
import type {
  ImageProviderAdapter,
  ImageProviderRequest,
  ImageProviderResponse,
  TextProviderAdapter,
  TextProviderRequest,
  TextProviderResponse,
  VisionProviderAdapter,
  VisionProviderRequest,
  VisionProviderResponse,
} from "./providers.ts";

type EnvLike = Partial<Record<string, string>>;

type ProviderOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  model?: string;
  /** OpenAI image quality tier ("low" | "medium" | "high" | "auto"). */
  quality?: string;
};

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const AZURE_OPENAI_DEFAULT_API_VERSION = "2024-10-21";
// best now, cost-tune later — gpt-image-2 processes inputs at max fidelity regardless.
const DEFAULT_OPENAI_IMAGE_QUALITY = "high";

export function createOpenRouterTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
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
        throw new Error("OPENROUTER_API_KEY is not configured.");
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

export function createOpenAiTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
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
        throw new Error("OPENAI_API_KEY is not configured.");
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

export function createAzureOpenAiTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
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
        throw new Error("AZURE_OPENAI_API_KEY is not configured.");
      }
      if (!deployment && !env.AZURE_OPENAI_CHAT_COMPLETIONS_URL) {
        throw new Error("AZURE_OPENAI_DEPLOYMENT is not configured.");
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

export function createOpenAiImageProvider(options: ProviderOptions = {}): ImageProviderAdapter {
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
        throw new Error("OPENAI_API_KEY is not configured.");
      }


      // Reference-based fit/extend → /images/edits (multipart). Otherwise the
      // text-to-image /images/generations path (JSON), unchanged.
      const response = input.requiresReferenceAssets
        ? await postOpenAiImageEdit({ env, apiKey, model, quality, input, fetchImpl })
        : await fetchImpl(env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_IMAGE_URL, {
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

      const payload = (await response.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Provider image request failed with ${response.status}.`);
      }

      const first = payload.data?.[0];

      return {
        assetUrl: first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : ""),
        seed: input.seed ?? 0,
        model,
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
    throw new Error("Reference-image edit requires at least one image.");
  }

  const form = new FormData();
  form.set("model", input.model);
  form.set("prompt", buildImagePrompt(input.input, { includeReferenceList: false }));
  form.set("size", imageSizeForAspect(input.input.aspectRatio));
  form.set("quality", input.quality);
  form.set("n", "1");

  const single = references.length === 1;
  for (const [index, reference] of references.entries()) {
    const blob = await imageReferenceToBlob(reference, input.fetchImpl, input.input.signal);
    // Single reference uses `image`; multiple uses `image[]` per the API contract.
    form.append(single ? "image" : "image[]", blob, `reference-${index}.png`);
  }

  if (input.input.maskImage) {
    const maskBlob = await imageReferenceToBlob(input.input.maskImage, input.fetchImpl, input.input.signal);
    form.set("mask", maskBlob, "mask.png");
  }

  // No explicit Content-Type — fetch sets the multipart boundary itself.
  return input.fetchImpl(resolveOpenAiImageEditsUrl(input.env), {
    method: "POST",
    signal: input.input.signal,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...gatewayHeaders(input.env),
    },
    body: form,
  });
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

export function createOpenRouterImageProvider(options: ProviderOptions = {}): ImageProviderAdapter {
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
        throw new Error("OPENROUTER_API_KEY is not configured.");
      }
      if (input.requiresReferenceAssets && input.referenceAssets.length === 0) {
        throw new Error("Reference-image repair requires at least one image.");
      }

      const response = await fetchImpl(OPENROUTER_CHAT_URL, {
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
          modalities: ["image", "text"],
          messages: [
            {
              role: "user",
              content: buildOpenRouterImageContent(input),
            },
          ],
        }),
      });
      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            images?: Array<{ image_url?: { url?: string }; url?: string }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `OpenRouter image request failed with ${response.status}.`);
      }

      const message = payload.choices?.[0]?.message;
      const assetUrl = message?.images?.[0]?.image_url?.url ?? message?.images?.[0]?.url ?? extractImageUrl(message?.content);

      return {
        assetUrl: assetUrl ?? "",
        seed: input.seed ?? 0,
        model,
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

export function createOpenAiVisionProvider(options: ProviderOptions = {}): VisionProviderAdapter {
  const textProvider = createOpenAiTextProvider(options);

  return {
    providerName: "openai",
    providerType: "vision_analysis",
    capabilities: {
      visionInput: true,
      screenshotAnalysis: true,
      ocr: true,
      structuredJson: true,
    },
    async analyse(input: VisionProviderRequest): Promise<VisionProviderResponse> {
      const output = await textProvider.generate({
        system: "Return compact JSON for the requested visual analysis task.",
        schemaName: "metaLeadAdPack",
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              task: input.task,
              images: input.images,
            }),
          },
        ],
      });

      return {
        json: output.json,
        confidence: 0.8,
      };
    },
  };
}

export function createTextProviderForCandidate(candidate: ModelCandidate, options: ProviderOptions = {}): TextProviderAdapter {
  if (candidate.provider === "openrouter") {
    return createOpenRouterTextProvider({ ...options, model: candidate.model });
  }
  if (candidate.provider === "azure") {
    return createAzureOpenAiTextProvider({ ...options, model: candidate.model });
  }
  return createOpenAiTextProvider({ ...options, model: candidate.model });
}

export function createImageProviderForCandidate(candidate: ModelCandidate, options: ProviderOptions = {}): ImageProviderAdapter {
  return candidate.provider === "openrouter"
    ? createOpenRouterImageProvider({ ...options, model: candidate.model })
    : createOpenAiImageProvider({ ...options, model: candidate.model });
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
  const response = await input.fetchImpl(input.url, {
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
    }),
  });
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Provider request failed with ${response.status}.`);
  }

  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "{}";

  return {
    json: parseJson(rawText),
    rawText,
    usage: {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    },
    providerMetadata: {
      model: input.model,
      schemaName: input.input.schemaName,
    },
  };
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

function buildOpenRouterImageContent(input: ImageProviderRequest): unknown {
  const prompt = buildImagePrompt(input);

  if (!input.referenceAssets.length) return prompt;

  return [
    { type: "text", text: prompt },
    ...input.referenceAssets.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];
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
  return formatImageSize(outpaintTargetForAspect(aspectRatio));
}
