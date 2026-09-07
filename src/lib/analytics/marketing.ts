import { getConsentStatus } from "@/components/consent-banner";

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
    clarity?: (action: "consent" | "event", value?: string) => void;
  }
}

export function isMarketingPath(pathname: string): boolean {
  return ![
    "/_next", "/access-unavailable", "/ad-studio", "/api", "/auth", "/booking",
    "/leads", "/model-control", "/onboarding", "/operator", "/results",
    "/self-serve", "/settings", "/workforce",
  ].some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

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
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) => {
      if (!SAFE_PROPERTY_NAMES.has(name) || value === undefined) return [];
      if (typeof value === "number" || typeof value === "boolean") return [[name, value]];
      const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
      return SAFE_VALUE.test(normalized) ? [[name, normalized]] : [];
    }),
  );
}

function eventProperties(properties: MarketingProperties): Record<string, string | number | boolean> {
  const safe = sanitizeMarketingProperties(properties);
  if (typeof window !== "undefined" && isMarketingPath(window.location.pathname)) {
    safe.page_type = pageType(window.location.pathname);
    safe.page_location = window.location.origin + window.location.pathname;
  }
  return safe;
}

/** Sends only consented, allow-listed marketing events to configured providers. */
export function trackMarketingEvent(eventName: string, properties: MarketingProperties = {}): void {
  if (typeof window === "undefined" || getConsentStatus() !== "granted") return;
  const event = eventName.trim().toLowerCase();
  if (!SAFE_EVENT_NAME.test(event)) return;
  const safeProperties = eventProperties(properties);
  try {
    window.gtag?.("event", event, safeProperties);
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
