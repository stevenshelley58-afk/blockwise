const PROVIDER_FAILURE_PATTERN =
  /openrouter|openai|azure|google|gemini|gpt-|claude|qwen|provider|api[_ -]?key|credits?|quota|billing|rate limit|model/i;

const SAFE_GENERATION_FAILURE =
  "Blockwise couldn't reach the ad generation service. Your details are still here. Try again in a moment.";

export function publicAdStudioGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return PROVIDER_FAILURE_PATTERN.test(message)
    ? SAFE_GENERATION_FAILURE
    : message || "Blockwise couldn't create the ad. Your details are still here. Try again.";
}
