import { modelForTask, type ResearchModelTask, type ResearchRuntimeEnv } from "./config.ts";

export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAiCompleteInput = {
  task: ResearchModelTask;
  messages: OpenAiMessage[];
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
};

export type OpenAiCompleteOutput = { model: string; content: string; raw: unknown };

export class OpenAiClient {
  constructor(
    private readonly env: ResearchRuntimeEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(input: OpenAiCompleteInput): Promise<OpenAiCompleteOutput> {
    const model = modelForTask(this.env, input.task);
    const response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
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
    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(raw)}`);
    const content = extractContent(raw);
    if (!content) throw new Error("OpenAI returned an empty response");
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
