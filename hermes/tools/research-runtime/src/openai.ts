import {
  modelForTask,
  providerForModel,
  resolveLlmEndpoint,
  type ResearchModelTask,
  type ResearchRuntimeEnv,
} from "./config.ts";

// OpenAI-compatible chat-completions client. The provider (Moonshot/Kimi or
// DashScope/Qwen), base URL, and API key come from the routing rule in
// config.ts; there is no hardcoded api.openai.com endpoint.

export type OpenAiMessageContent = string | Array<Record<string, unknown>>;

export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: OpenAiMessageContent;
};

export type OpenAiCompleteInput = {
  task: ResearchModelTask;
  messages: OpenAiMessage[];
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
};

export type OpenAiCompleteOutput = { model: string; provider: string; content: string; raw: unknown };

export class OpenAiClient {
  constructor(
    private readonly env: ResearchRuntimeEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(input: OpenAiCompleteInput): Promise<OpenAiCompleteOutput> {
    const model = modelForTask(this.env, input.task);
    const endpoint = resolveLlmEndpoint(this.env, model);
    const response = await this.fetchImpl(endpoint.chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        max_completion_tokens: input.maxTokens,
        response_format: input.responseFormat,
      }),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${endpoint.provider} request failed: ${response.status} ${JSON.stringify(raw)}`);
    const content = extractContent(raw);
    if (!content) throw new Error(`${endpoint.provider} returned an empty response`);
    return { model, provider: providerForModel(model), content, raw };
  }
}

function extractContent(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === "string" ? first.message.content : "";
}
