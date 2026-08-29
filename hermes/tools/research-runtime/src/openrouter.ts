import { modelForEscalation, modelForTask, type OpenRouterTask, type ResearchRuntimeEnv } from "./config.ts";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenRouterCompleteInput = {
  task: OpenRouterTask;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  useEscalationModel?: boolean;
};

export type OpenRouterCompleteOutput = {
  model: string;
  content: string;
  raw: unknown;
};

export class OpenRouterClient {
  constructor(
    private readonly env: ResearchRuntimeEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(input: OpenRouterCompleteInput): Promise<OpenRouterCompleteOutput> {
    if (!this.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const model = input.useEscalationModel
      ? modelForEscalation(this.env, input.task)
      : modelForTask(this.env, input.task);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    };
    if (this.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = this.env.OPENROUTER_SITE_URL;
    if (this.env.OPENROUTER_APP_NAME) headers["X-Title"] = this.env.OPENROUTER_APP_NAME;

    const response = await this.fetchImpl(`${this.env.OPENROUTER_BASE_URL.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0,
        max_tokens: input.maxTokens,
        response_format: input.responseFormat,
      }),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status} ${JSON.stringify(raw)}`);
    }
    const content = extractContent(raw);
    return { model, content, raw };
  }
}

function extractContent(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === "string" ? first.message.content : "";
}
