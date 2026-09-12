import { getConsentStatus } from "./consent.ts";
import { isAnalyticsExcludedPath } from "./events.ts";

// The GA4 tag installed by MarketingAnalytics owns these globals. They are
// typed here because every consumer of window.gtag imports this module.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

type MarketingValue = string | number | boolean | undefined;
type MarketingProperties = Record<string, MarketingValue>;

const SAFE_PROPERTY_NAMES = new Set([
  "content_name",
  "cta_location",
  "form_type",
  "goal",
  "intent",
  "method",
  "page_type",
  "placement",
  "source",
]);
const SAFE_EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_VALUE = /^[a-z0-9_\-]{1,80}$/;

declare global {
  interface Window {
    [key: `ga-disable-${string}`]: boolean | undefined;
    clarity?: (action: "consentv2" | "event" | "start" | "stop", value?: string | { ad_Storage: "granted" | "denied"; analytics_Storage: "granted" | "denied" }) => void;
  }
}

export function isMarketingPath(pathname: string): boolean {
  return !isAnalyticsExcludedPath(pathname)
    && (["/", "/pricing", "/signup", "/audit", "/guides", "/privacy", "/terms", "/data-deletion"].includes(pathname)
    || /^\/guides\/[a-z0-9-]+$/.test(pathname)
    || /^\/(audit|suburb)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(pathname));
}

export function marketingPageLocation(origin: string, pathname: string): string {
  // Research URLs may embed a postcode or an opaque identifier.
  const safePath = /^\/(audit|suburb)\//.test(pathname) ? "/" + pathname.split("/")[1] : pathname;
  return origin + safePath;
}

export function validGa4Id(value?: string): value is string { return /^G-[A-Z0-9]{4,20}$/.test(value ?? ""); }
export function validClarityId(value?: string): value is string { return /^[a-z0-9]{8,32}$/.test(value ?? ""); }

function pageType(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/pricing")) return "pricing";
  if (pathname.startsWith("/guides")) return "guide";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/suburb")) return "suburb_report";
  if (pathname.startsWith("/signup")) return "signup";
  return "marketing";
}

export function sanitizeMarketingProperties(properties: MarketingProperties = {}): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (!SAFE_PROPERTY_NAMES.has(name)) continue;
    if (typeof value === "boolean") { safe[name] = value; continue; }
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
    if (SAFE_VALUE.test(normalized)) safe[name] = normalized;
  }
  return safe;
}

function eventProperties(properties: MarketingProperties): Record<string, string | number | boolean> {
  const safe = sanitizeMarketingProperties(properties);
  if (typeof window !== "undefined" && isMarketingPath(window.location.pathname)) {
    safe.page_type = pageType(window.location.pathname);
    safe.page_location = marketingPageLocation(window.location.origin, window.location.pathname);
  }
  return safe;
}

/** Sends only consented, allow-listed marketing events to configured providers. */
export function trackMarketingEvent(eventName: string, properties: MarketingProperties = {}): void {
  if (typeof window === "undefined" || getConsentStatus() !== "granted" || !isMarketingPath(window.location.pathname)) return;
  const event = eventName.trim().toLowerCase();
  if (!SAFE_EVENT_NAME.test(event)) return;
  const safeProperties = eventProperties(properties);
  try {
    window.gtag?.("event", event, { ...safeProperties, page_referrer: "", page_title: safeProperties.page_type });
  } catch {
    // Analytics must never interrupt the user flow.
  }
  try {
    window.clarity?.("event", "bw_" + event);
  } catch {
    // Analytics must never interrupt the user flow.
  }
}

export function trackMarketingPageView(pathname: string): void {
  if (!isMarketingPath(pathname)) return;
  trackMarketingEvent("page_view", { page_type: pageType(pathname) });
}

/** Google's supported opt-out also stops an already-loaded tag on private routes. */
export function setGa4Collection(measurementId: string | undefined, enabled: boolean): void {
  if (typeof window === "undefined" || !validGa4Id(measurementId)) return;
  window[`ga-disable-${measurementId}`] = !enabled;
}
