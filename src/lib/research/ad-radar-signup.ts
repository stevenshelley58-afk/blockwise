const POSTCODE_PATTERN = /^\d{4}$/u;

export type AdRadarSignupContext = {
  postcode: string | null;
  source: "suburb-report" | null;
  intent: "track" | "remix" | "trial" | null;
};

/** Keep the suburb-report handoff explicit and bounded before it reaches auth metadata. */
export function normalizeAdRadarPostcode(value: unknown): string | null {
  const postcode = typeof value === "string" ? value.trim() : "";
  return POSTCODE_PATTERN.test(postcode) ? postcode : null;
}

export function readAdRadarSignupContext(search: string): AdRadarSignupContext {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const source = params.get("src") === "suburb-report" ? "suburb-report" : null;
  const intentValue = params.get("intent");
  const intent = intentValue === "track" || intentValue === "remix" || intentValue === "trial"
    ? intentValue
    : null;

  return {
    postcode: normalizeAdRadarPostcode(params.get("postcode")),
    source,
    intent,
  };
}

export function adRadarSignupMetadata(search: string): Record<string, string> {
  const context = readAdRadarSignupContext(search);
  return {
    ...(context.postcode ? { ad_radar_postcode: context.postcode } : {}),
    ...(context.source ? { ad_radar_source: context.source } : {}),
    ...(context.intent ? { ad_radar_intent: context.intent } : {}),
  };
}
