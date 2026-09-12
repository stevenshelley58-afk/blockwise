const POSTCODE_PATTERN = /^\d{4}$/u;
const SOURCE_PATTERN = /^(?:audit|local-ad-radar|suburb-report)$/u;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const SAFE_ATTRIBUTION_TEXT_PATTERN = /^[\p{L}\p{N}\p{M}\p{Zs},.&'()/+_:-]+$/u;
const EMAIL_PATTERN = /\S+@\S+\.\S+/u;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/u;

const MAX_MARKET_LENGTH = 120;
const MAX_ANGLE_LENGTH = 160;
const MAX_REFERENCE_LENGTH = 128;

export type AdRadarSignupContext = {
  postcode: string | null;
  source: "audit" | "local-ad-radar" | "suburb-report" | null;
  intent: "track" | "remix" | "trial" | null;
  market: string | null;
  angle: string | null;
  adRef: string | null;
};

/** Keep the suburb-report handoff explicit and bounded before it reaches auth metadata. */
export function normalizeAdRadarPostcode(value: unknown): string | null {
  const postcode = typeof value === "string" ? value.trim() : "";
  return POSTCODE_PATTERN.test(postcode) ? postcode : null;
}

/**
 * Keep public attribution labels useful to the owner CRM without allowing
 * arbitrary query-string content into auth metadata.
 */
function normalizeAttributionText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const rawText = value.trim();
  if (
    rawText.length === 0 ||
    rawText.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(rawText) ||
    !SAFE_ATTRIBUTION_TEXT_PATTERN.test(rawText) ||
    EMAIL_PATTERN.test(rawText) ||
    PHONE_PATTERN.test(rawText)
  ) {
    return null;
  }
  return rawText.replace(/\s+/gu, " ");
}

export function normalizeAdRadarMarket(value: unknown): string | null {
  return normalizeAttributionText(value, MAX_MARKET_LENGTH);
}

export function normalizeAdRadarAngle(value: unknown): string | null {
  return normalizeAttributionText(value, MAX_ANGLE_LENGTH);
}

export function normalizeAdRadarReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reference = value.trim();
  return reference.length <= MAX_REFERENCE_LENGTH && OPAQUE_REFERENCE_PATTERN.test(reference)
    ? reference
    : null;
}

export function readAdRadarSignupContext(search: string): AdRadarSignupContext {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sourceValue = params.get("source")?.trim() || params.get("src")?.trim() || "";
  const source = SOURCE_PATTERN.test(sourceValue)
    ? (sourceValue as AdRadarSignupContext["source"])
    : null;
  const intentValue = params.get("intent");
  const intent = intentValue === "track" || intentValue === "remix" || intentValue === "trial"
    ? intentValue
    : null;

  return {
    postcode: normalizeAdRadarPostcode(params.get("postcode")),
    source,
    intent,
    market: source ? normalizeAdRadarMarket(params.get("market")) : null,
    angle: source ? normalizeAdRadarAngle(params.get("angle")) : null,
    adRef: source ? normalizeAdRadarReference(params.get("adRef")) : null,
  };
}

export function adRadarSignupMetadata(search: string): Record<string, string> {
  const context = readAdRadarSignupContext(search);
  return {
    ...(context.postcode ? { ad_radar_postcode: context.postcode } : {}),
    ...(context.source ? { ad_radar_source: context.source } : {}),
    ...(context.intent ? { ad_radar_intent: context.intent } : {}),
    ...(context.market ? { ad_radar_market: context.market } : {}),
    ...(context.angle ? { ad_radar_angle: context.angle } : {}),
    ...(context.adRef ? { ad_radar_ad_ref: context.adRef } : {}),
  };
}
