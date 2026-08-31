/**
 * Derive the client IP from proxy headers.
 *
 * Production runs behind Caddy on the VPS (and Vercel in preview). Caddy
 * appends the real peer address to `x-forwarded-for`, so the RIGHT-most
 * entry is the only one our trusted proxy vouches for. Left-most entries
 * are client-controlled and trivially spoofable, so they must never be
 * used for rate limiting or audit attribution.
 */
export function getClientIp(headers: Headers | { get(name: string): string | null }): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const entries = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => isPlausibleIp(entry));
    if (entries.length > 0) {
      return entries[entries.length - 1];
    }
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function isPlausibleIp(value: string): boolean {
  if (!value || value.length > 45) return false;
  // IPv4 or IPv6-ish; exact parsing is unnecessary — the trusted proxy
  // supplies well-formed addresses and we only need to skip garbage.
  return /^[0-9a-fA-F.:]+$/.test(value);
}
