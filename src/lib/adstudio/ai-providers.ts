import type {
  ModelCandidate,
} from "@/lib/ai/model-registry";

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
};

type MixedImageVariantOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  openAiCount?: number;
  openRouterCount?: number;
  openAiModel?: string;
  openRouterModel?: string;
};

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";

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

export function createOpenAiImageProvider(options: ProviderOptions = {}): ImageProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openai",
    providerType: "image_generation",
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

      if (input.requiresReferenceAssets || input.referenceAssets.length > 0) {
        if (!input.referenceAssets.length) {
          throw new Error("Reference-image generation requires at least one image.");
        }
        return generateOpenAiImageEdit({
          env,
          fetchImpl,
          apiKey,
          model,
          input,
        });
      }

      const response = await fetchImpl(env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_IMAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...gatewayHeaders(env),
        },
        body: JSON.stringify({
          model,
          prompt: buildImagePrompt(input),
          size: imageSizeForAspect(input.aspectRatio),
          quality: "high",
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
        providerMetadata: { provider: "openai", referenceAssets: input.referenceAssets.length },
      };
    },
  };
}

async function generateOpenAiImageEdit(input: {
  env: EnvLike;
  fetchImpl: typeof fetch;
  apiKey: string;
  model: string;
  input: ImageProviderRequest;
}): Promise<ImageProviderResponse> {
  const body = new FormData();
  body.set("model", input.model);
  body.set("prompt", buildImagePrompt(input.input));
  body.set("size", imageSizeForAspect(input.input.aspectRatio));
  body.set("quality", "high");
  body.set("n", "1");

  input.input.referenceAssets.slice(0, 16).forEach((asset, index) => {
    body.append(index === 0 ? "image" : "image[]", imageBlobFromDataUrl(asset), `reference-${index + 1}.png`);
  });

  const response = await input.fetchImpl(input.env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_IMAGE_EDIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...gatewayHeaders(input.env),
    },
    body,
  });
  const payload = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Provider image edit request failed with ${response.status}.`);
  }

  const first = payload.data?.[0];

  return {
    assetUrl: first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : ""),
    seed: input.input.seed ?? 0,
    model: input.model,
    providerMetadata: {
      provider: "openai",
      endpoint: "images.edit",
      referenceAssets: input.input.referenceAssets.length,
    },
  };
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

export async function generateMixedImageVariantsInParallel(
  input: ImageProviderRequest,
  options: MixedImageVariantOptions = {},
): Promise<ImageProviderResponse[]> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const openAiCount = options.openAiCount ?? 2;
  const openRouterCount = options.openRouterCount ?? 2;
  const openAiProvider = createOpenAiImageProvider({
    env,
    fetchImpl,
    model: options.openAiModel ?? env.BLOCKWISE_OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  });
  const openRouterProvider = createOpenRouterImageProvider({
    env,
    fetchImpl,
    model: options.openRouterModel ?? env.BLOCKWISE_OPENROUTER_IMAGE_MODEL ?? "google/gemini-3.1-flash-image-preview",
  });
  const jobs = [
    ...Array.from({ length: openAiCount }, (_, index) => ({ provider: openAiProvider, index })),
    ...Array.from({ length: openRouterCount }, (_, index) => ({ provider: openRouterProvider, index: index + openAiCount })),
  ];

  return Promise.all(
    jobs.map(({ provider, index }) =>
      provider.generate({
        ...input,
        seed: (input.seed ?? 0) + index + 1,
      }),
    ),
  );
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
  return candidate.provider === "openrouter"
    ? createOpenRouterTextProvider({ ...options, model: candidate.model })
    : createOpenAiTextProvider({ ...options, model: candidate.model });
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
}): Promise<TextProviderResponse> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      ...input.headers,
    },
    body: JSON.stringify({
      model: input.model,
      messages: buildChatMessages(input.input),
      response_format: { type: "json_object" },
      temperature: 0.4,
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

function imageBlobFromDataUrl(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("OpenAI image edits require resolved data URL reference images.");
  }

  const contentType = match[1] ?? "image/png";
  const base64 = match[2] ?? "";
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return new Blob([bytes], { type: contentType });
}

function buildImagePrompt(input: ImageProviderRequest): string {
  return [
    input.prompt,
    `Aspect ratio: ${input.aspectRatio}.`,
    `Style preset: ${input.stylePreset}.`,
    input.negativePrompt ? `Avoid: ${input.negativePrompt}.` : "",
    input.referenceAssets.length ? `Reference assets: ${input.referenceAssets.join(", ")}.` : "",
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
  if (aspectRatio === "9:16") return "1024x1792";
  if (aspectRatio === "1.91:1") return "1792x1024";
  if (aspectRatio === "4:5") return "1024x1280";

  return "1024x1024";
}
