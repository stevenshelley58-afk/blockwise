/**
 * Reads the `exp` claim out of a Supabase auth cookie without verifying it.
 *
 * This is not an authorization decision. It exists so the request proxy can
 * tell "this session is fine, nothing to do" from "this session is about to
 * expire, refresh it", because this project signs access tokens with the legacy
 * HS256 secret and auth-js can only verify such a token by calling the Auth
 * server. Without this check the proxy performed an Auth round trip in front of
 * every matched request (measured ~219ms per authenticated request).
 *
 * Every surface that acts on identity re-verifies it, so a forged `exp` can at
 * most cause the proxy to skip a refresh; it can never grant access.
 */

const BASE64_PREFIX = "base64-";

/** Minimal shape needed from a request's cookies; avoids importing Next types. */
export type CookieSource = { getAll(): Array<{ name: string; value: string }> };

function decodeCookieValue(value: string): unknown | null {
  let raw = value;
  if (raw.startsWith(BASE64_PREFIX)) {
    try {
      raw = Buffer.from(raw.slice(BASE64_PREFIX.length), "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function accessTokenFrom(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    return typeof parsed[0] === "string" ? parsed[0] : null;
  }
  const token = (parsed as { access_token?: unknown } | null)?.access_token;
  return typeof token === "string" ? token : null;
}

function expiryFromToken(token: string): number | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Returns the access token expiry in epoch seconds, or null when no Supabase
 * auth cookie is present or none of them can be parsed. A null result must make
 * the caller fall through to the real, verifying refresh.
 */
export function accessTokenExpirySeconds(cookies: CookieSource): number | null {
  for (const { name, value } of cookies.getAll()) {
    if (!name.startsWith("sb-") || !name.includes("auth-token")) continue;
    const parsed = decodeCookieValue(value);
    if (parsed === null) continue;
    const token = accessTokenFrom(parsed);
    if (!token) continue;
    const expiry = expiryFromToken(token);
    if (expiry !== null) return expiry;
  }
  return null;
}
