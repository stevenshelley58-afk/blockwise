import type { ModelCandidate } from "../ai/model-registry.ts";

import type { ContentSkillName, CreateContentRunInput } from "./contracts.ts";
import { deterministicContentSkillOutput } from "./deterministic.ts";

type EnvLike = Partial<Record<string, string>>;

export type ContentGenerationRequest = {
  skillName: ContentSkillName;
  prompt: string;
  model: ModelCandidate;
  run: CreateContentRunInput & { id?: string };
  artifacts: Record<string, unknown>;
};

export type ContentGenerationProvider = {
  generate(request: ContentGenerationRequest): Promise<Record<string, unknown>>;
};

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export function createDeterministicContentProvider(): ContentGenerationProvider {
  return {
    async generate(request) {
      return deterministicContentSkillOutput(request.skillName, {
        run: request.run,
        artifacts: request.artifacts,
      });
    },
  };
}

export function createLiveContentProvider(options: {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
} = {}): ContentGenerationProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (env.CONTENT_ENGINE_DRY_RUN === "true") {
    return createDeterministicContentProvider();
  }

  return {
    async generate(request) {
      if (request.model.provider === "openrouter") {
        return postJsonChat({
          url: OPENROUTER_CHAT_URL,
          apiKey: requireEnv(env, "OPENROUTER_API_KEY"),
          model: request.model.model,
          prompt: request.prompt,
          fetchImpl,
          headers: {
            "HTTP-Referer": env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
            "X-Title": "Blockwise",
          },
        });
      }

      return postJsonChat({
        url: env.CLOUDFLARE_AI_GATEWAY_URL ?? OPENAI_CHAT_URL,
        apiKey: requireEnv(env, "OPENAI_API_KEY"),
        model: request.model.model,
        prompt: request.prompt,
        fetchImpl,
        headers: gatewayHeaders(env),
      });
    },
  };
}

async function postJsonChat(input: {
  url: string;
  apiKey: string;
  model: string;
  prompt: string;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
}): Promise<Record<string, unknown>> {
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
        {
          role: "system",
          content: "Return one valid JSON object and no surrounding prose.",
        },
        {
          role: "user",
          content: input.prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Content model request failed with status ${response.status}.`);
  }

  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "{}";
  const parsed = JSON.parse(rawText) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Content model returned JSON that was not an object.");
  }

  return parsed as Record<string, unknown>;
}

function requireEnv(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not configured.`);
  return value;
}

function gatewayHeaders(env: EnvLike): Record<string, string> {
  return env.CLOUDFLARE_AI_GATEWAY_TOKEN
    ? { "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}` }
    : {};
}
