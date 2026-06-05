export type DeviceClass = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

/** Operator/internal surfaces are never tracked; neither are API or asset paths. */
const UNTRACKED_PREFIXES = ["/operator", "/approvals", "/agents", "/model-control", "/api", "/_next"];

export function isTrackablePath(path: string): boolean {
  return !UNTRACKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Validates a client-supplied path and strips query strings and fragments. */
export function normalizeTrackedPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const bare = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  if (bare.length === 0 || bare.length > 512) return null;
  return bare;
}

export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/bot|crawl|spider|slurp|preview|lighthouse|headless|pingdom|monitor|scrape|fetch|curl|wget|python-requests/.test(ua)) return "bot";
  if (/ipad|tablet|kindle|silk|playbook/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|windows phone/.test(ua)) return "mobile";
  if (/android/.test(ua)) return "tablet";
  return "desktop";
}

/** Returns the bare external referrer host, or null for same-site/invalid referrers. */
export function externalReferrerHost(referrer: unknown, ownHost: string | null): string | null {
  if (typeof referrer !== "string" || referrer.length === 0) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host) return null;
    if (ownHost && (host === ownHost || host.endsWith(`.${ownHost}`))) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}
