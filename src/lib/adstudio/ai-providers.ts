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

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

export function createOpenRouterTextProvider(options: ProviderOptions = {}): TextProviderAdapter {
  const env = options.env ?? process.env;
  const model = options.model ?? env.BLOCKWISE_OPENROUTER_TEXT_MODEL ?? "openai/gpt-4.1-mini";
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
  const model = options.model ?? env.BLOCKWISE_OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
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
  const model = options.model ?? env.BLOCKWISE_OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    providerName: "openai",
    providerType: "image_generation",
    capabilities: {
      textToImage: true,
      imageToImage: true,
      multiReference: true,
    },
    async generate(input) {
      const apiKey = env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured.");
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
          n: 1,
        }),
      });
      const payload = (await response.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `OpenAI image request failed with ${response.status}.`);
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
      messages: [
        { role: "system", content: input.input.system },
        ...input.input.messages,
      ],
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
    throw new Error(payload.error?.message ?? `AI provider request failed with ${response.status}.`);
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

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error("AI provider returned non-JSON content.");
  }
}

function gatewayHeaders(env: EnvLike): Record<string, string> {
  return env.CLOUDFLARE_AI_GATEWAY_TOKEN
    ? { "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}` }
    : {};
}

function buildImagePrompt(input: ImageProviderRequest): string {
  return [
    input.prompt,
    `Style preset: ${input.stylePreset}.`,
    input.negativePrompt ? `Avoid: ${input.negativePrompt}.` : "",
    input.referenceAssets.length ? `Reference assets: ${input.referenceAssets.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

function imageSizeForAspect(aspectRatio: string): string {
  if (aspectRatio === "9:16") return "1024x1792";
  if (aspectRatio === "1.91:1") return "1792x1024";

  return "1024x1024";
}
