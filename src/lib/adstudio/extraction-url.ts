import { isExampleBrandKitSourceUrl } from "./persistence.ts";

export type ExtractionUrlResult =
  | { ok: true; url: string; error?: never }
  | { ok: false; url?: never; error: string };

export function normalizeAndValidateExtractionUrl(value: string | null | undefined): ExtractionUrlResult {
  const raw = value?.trim();
  if (!raw) return { ok: false, error: "Website URL is required." };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, error: "Website URL must use http or https." };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "Enter a valid website URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Website URL must use http or https." };
  }

  url.hash = "";
  const host = url.hostname.toLowerCase();
  if (isExampleBrandKitSourceUrl(url.toString()) || isBlockedHost(host)) {
    return { ok: false, error: "Use your public agency website." };
  }

  return { ok: true, url: url.toString().replace(/\/$/, "") };
}

function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) return true;

  // IPv6 addresses (bare or bracketed)
  const ipv6Raw = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : null;
  const ipv6Candidate = ipv6Raw ?? (host.includes(":") ? host : null);
  if (ipv6Candidate !== null) {
    const lower = ipv6Candidate.toLowerCase();
    if (lower === "::1") return true;
    // IPv6-mapped IPv4: ::ffff:a.b.c.d (decimal) or ::ffff:aabb:ccdd (hex, as emitted by URL parser)
    const mappedDecimal = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDecimal) {
      return isBlockedHost(mappedDecimal[1]);
    }
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedHost(ipv4);
    }
    // Link-local fe80::/10
    if (/^fe[89ab]/i.test(lower)) return true;
    // ULA fc00::/7 (fc and fd prefixes)
    if (/^f[cd]/i.test(lower)) return true;
    return false;
  }

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
