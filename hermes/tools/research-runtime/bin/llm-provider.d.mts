export const DEFAULT_LLM_MODEL: string;
export const MOONSHOT_BASE_URL: string;
export const DASHSCOPE_BASE_URL: string;
export const DEFAULT_TASK_MODELS: Record<string, string>;
export const DEFAULT_CONTENT_POLICY_MODELS: Record<string, string>;

export type LlmProvider = "moonshot" | "dashscope";

export type LlmEndpoint = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  chatUrl: string;
};

export function providerForModel(model: string): LlmProvider;
export function resolveLlmEndpoint(env: Record<string, unknown>, model: string): LlmEndpoint;
export function modelForResearchTask(env: Record<string, unknown>, task: string): string;
export function parseModelsJson(value: unknown): Record<string, unknown>;
export function cleanString(value: unknown): string | null;
