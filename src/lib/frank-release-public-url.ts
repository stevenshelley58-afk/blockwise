import { isBlockedPublicNetworkHost } from "./security/public-network-host.ts";

const CREDENTIAL_QUERY_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "key",
  "secret",
  "signature",
  "sig",
  "auth",
  "authorization",
]);
const CREDENTIAL_QUERY_FRAGMENTS = ["token", "secret", "signature", "apikey"] as const;
const PRIVATE_REF_PATTERN = /\b(?:openbao|vault|secret|file|private|provider):\/\//iu;
const UNSAFE_MARKUP_PATTERN = /(?:<\/?[a-z][^>]*>|javascript\s*:|-----begin [a-z ]+-----)/iu;
const PRIVATE_VALUE_PATTERN = /(?:bearer\s+[a-z0-9._~+/=-]{16,}|(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+)/iu;
const SECRET_CONTENT_PATTERN = /\b(?:secret|password|credential|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key)\b\s*(?::|=|is\b|value\b|data\b|payload\b|material\b)/iu;
const EMAIL_VALUE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const PHONE_VALUE_PATTERN = /\+?\d[\d ()-]{7,}\d/gu;
const RESTRICTED_REFERENCE_COMPONENT_PATTERN = /(?:^|[/:._\s-])(?:private|provider|prospect|outreach)(?:$|[/:._\s-])/iu;
const ENCODED_OCTET_PATTERN = /%[0-9a-f]{2}/iu;
const MALFORMED_PERCENT_PATTERN = /%(?![0-9a-f]{2})/iu;
const UNSAFE_DECODED_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\ufffd\ud800-\udfff]/u;
const BACKSLASH_PATTERN = /\\/u;
const NESTED_URL_PATTERN = /(?:https?:)?\/\/[^\s/]/iu;
const MAX_DECODE_ROUNDS = 3;

export type PublicFrankReleaseUrlOptions = {
  referenceLike?: boolean;
};

/** Validate and normalize a credential-free, globally routable HTTPS URL. */
export function publicFrankReleaseUrl(
  value: unknown,
  options: PublicFrankReleaseUrlOptions = {},
): string | null {
  if (typeof value !== "string" || !value) return null;
  if (
    MALFORMED_PERCENT_PATTERN.test(value)
    || UNSAFE_DECODED_CHARACTER_PATTERN.test(value)
    || BACKSLASH_PATTERN.test(value)
  ) return null;

  const rawComponents = decodeRawUrlComponents(value);
  if (rawComponents === null) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || value.includes("#")) return null;
    if (isBlockedPublicNetworkHost(url.hostname)) return null;

    for (const key of rawComponents.queryKeys) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (CREDENTIAL_QUERY_KEYS.has(normalized)) return null;
      if (CREDENTIAL_QUERY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return null;
    }

    const decodedComponents = [rawComponents.pathname, ...rawComponents.queryValues];
    for (const component of decodedComponents) {
      if (hasUnsafeDecodedUrlContent(component)) return null;
      if (options.referenceLike && RESTRICTED_REFERENCE_COMPONENT_PATTERN.test(component)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

type DecodedRawUrlComponents = {
  pathname: string;
  queryKeys: string[];
  queryValues: string[];
};

function decodeRawUrlComponents(value: string): DecodedRawUrlComponents | null {
  const schemeSeparator = value.indexOf("://");
  if (schemeSeparator < 1) return null;

  const authorityStart = schemeSeparator + 3;
  const componentStart = findFirstComponentDelimiter(value, authorityStart);
  const pathAndQuery = componentStart < 0 ? "" : value.slice(componentStart);
  const queryStart = pathAndQuery.indexOf("?");
  const rawPathname = queryStart < 0 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
  const rawQuery = queryStart < 0 ? "" : pathAndQuery.slice(queryStart + 1);
  const pathname = decodeUrlComponentToFixedPoint(rawPathname, false);
  if (pathname === null) return null;

  const queryKeys: string[] = [];
  const queryValues: string[] = [];
  if (queryStart >= 0) {
    for (const entry of rawQuery.split("&")) {
      const separator = entry.indexOf("=");
      const rawKey = separator < 0 ? entry : entry.slice(0, separator);
      const rawValue = separator < 0 ? "" : entry.slice(separator + 1);
      const key = decodeUrlComponentToFixedPoint(rawKey, true);
      const queryValue = decodeUrlComponentToFixedPoint(rawValue, true);
      if (key === null || queryValue === null) return null;
      queryKeys.push(key);
      queryValues.push(queryValue);
    }
  }

  return { pathname, queryKeys, queryValues };
}

function findFirstComponentDelimiter(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "/" || character === "?" || character === "#") return index;
  }
  return -1;
}

function decodeUrlComponentToFixedPoint(value: string, queryComponent: boolean): string | null {
  let decoded = queryComponent ? value.replace(/\+/gu, "%20") : value;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    if (MALFORMED_PERCENT_PATTERN.test(decoded)) return null;
    if (UNSAFE_DECODED_CHARACTER_PATTERN.test(decoded) || BACKSLASH_PATTERN.test(decoded)) return null;
    if (!ENCODED_OCTET_PATTERN.test(decoded)) return decoded;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }
  if (
    MALFORMED_PERCENT_PATTERN.test(decoded)
    || ENCODED_OCTET_PATTERN.test(decoded)
    || UNSAFE_DECODED_CHARACTER_PATTERN.test(decoded)
    || BACKSLASH_PATTERN.test(decoded)
  ) return null;
  return decoded;
}

function hasUnsafeDecodedUrlContent(value: string): boolean {
  return PRIVATE_REF_PATTERN.test(value)
    || UNSAFE_MARKUP_PATTERN.test(value)
    || PRIVATE_VALUE_PATTERN.test(value)
    || SECRET_CONTENT_PATTERN.test(value)
    || EMAIL_VALUE_PATTERN.test(value)
    || hasPhoneValue(value)
    // Public release references never need to carry another URL. Rejecting all
    // nested absolute and scheme-relative URLs avoids redirect/SSRF ambiguity.
    || NESTED_URL_PATTERN.test(value);
}

function hasPhoneValue(value: string): boolean {
  for (const match of value.matchAll(PHONE_VALUE_PATTERN)) {
    const candidate = match[0];
    if (/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) continue;
    const digits = candidate.replace(/\D/gu, "");
    if (candidate.startsWith("+") || digits.length >= 10 || /[ ()]/u.test(candidate)) return true;
  }
  return false;
}
