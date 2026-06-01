import type { EnvLike, ModelCatalogOption } from "./model-control-config.ts";
import { normalizeModelSlug } from "./model-registry.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const APP_TITLE = "Blockwise";
const DEFAULT_APP_URL = "http://localhost:3000";

type TestOpenRouterModelInput = {
  model: string;
  requireParameters?: boolean;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type OpenRouterModelsResponse = {
  data?: OpenRouterModelRecord[];
  error?: {
    message?: string;
  };
};

type OpenRouterModelRecord = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
};

export type OpenRouterTestResult = {
  content: string;
};

export async function fetchOpenRouterModelCatalog({
  env = process.env as EnvLike,
  fetchImpl = fetch,
}: {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
} = {}): Promise<ModelCatalogOption[]> {
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, {
    method: "GET",
    headers: buildOpenRouterHeaders(env),
  });
  const payload = (await response.json()) as OpenRouterModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenRouter models request failed with status ${response.status}.`);
  }

  return (payload.data ?? []).map(mapOpenRouterModelRecord);
}

export async function testOpenRouterModel({
  model,
  requireParameters = false,
  env = process.env as EnvLike,
  fetchImpl = fetch,
}: TestOpenRouterModelInput): Promise<OpenRouterTestResult> {
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: buildOpenRouterHeaders(env),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Reply exactly OK.",
        },
        {
          role: "user",
          content: "Return OK",
        },
      ],
      temperature: 0,
      max_tokens: 8,
      provider: {
        require_parameters: requireParameters,
      },
    }),
  });

  const payload = (await response.json()) as OpenRouterChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenRouter request failed with status ${response.status}.`);
  }

  return {
    content: payload.choices?.[0]?.message?.content?.trim() ?? "",
  };
}

export function buildOpenRouterHeaders(env: EnvLike = process.env as EnvLike): HeadersInit {
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
    "X-Title": APP_TITLE,
  };
}

function mapOpenRouterModelRecord(model: OpenRouterModelRecord): ModelCatalogOption {
  const supportedParameters = model.supported_parameters ?? [];
  const inputModalities = model.architecture?.input_modalities ?? [];
  const outputModalities = model.architecture?.output_modalities ?? [];

  return {
    provider: "openrouter",
    model: normalizeModelSlug("openrouter", model.id),
    label: model.name ?? normalizeModelSlug("openrouter", model.id),
    inputUsdPerMillionTokens: pricePerTokenToPerMillion(model.pricing?.prompt),
    outputUsdPerMillionTokens: pricePerTokenToPerMillion(model.pricing?.completion),
    imageUsdPerUnit: Number(model.pricing?.image ?? 0),
    maxContextTokens: model.context_length ?? 0,
    supportsStructuredOutput:
      supportedParameters.includes("response_format") || supportedParameters.includes("structured_outputs"),
    supportsVisionInput: inputModalities.includes("image"),
    supportsImageOutput: outputModalities.includes("image"),
  };
}

function pricePerTokenToPerMillion(value?: string): number {
  return Math.round(Number(value ?? 0) * 1_000_000 * 1_000_000) / 1_000_000;
}
