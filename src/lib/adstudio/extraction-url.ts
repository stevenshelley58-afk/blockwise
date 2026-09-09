import { isExampleBrandKitSourceUrl } from "./persistence.ts";
import { isBlockedPublicNetworkHost } from "../security/public-network-host.ts";

export type ExtractionUrlResult =
  | { ok: true; url: string; error?: never }
  | { ok: false; url?: never; error: string };

/** True when the hostname ends with an Australian TLD (.com.au, .net.au, .org.au, .au). */
export function isAustralianListingDomain(hostname: string): boolean {
  return /\.(com\.au|net\.au|org\.au|au)$/i.test(hostname);
}

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
  if (isExampleBrandKitSourceUrl(url.toString()) || isBlockedPublicNetworkHost(host)) {
    return { ok: false, error: "Use your public agency website." };
  }

  return { ok: true, url: url.toString().replace(/\/$/, "") };
}
