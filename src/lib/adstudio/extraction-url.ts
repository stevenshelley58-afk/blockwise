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
  if (host === "::1" || host === "[::1]") return true;

  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
