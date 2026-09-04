/**
 * Derive the client IP for rate limiting and audit attribution.
 *
 * Proxy chain in production: Frank shared edge -> product Caddy -> Next.js.
 * The product Caddyfile (infra/product/Caddyfile) resolves the real customer
 * address — with the Frank edge as the only trusted proxy, so Caddy ignores
 * client-supplied X-Forwarded-For entries — and stamps it into the dedicated
 * `x-blockwise-client-ip` header, overwriting whatever the client sent. That
 * header is trusted first.
 *
 * The fallbacks cover preview deploys and local development where the edge
 * is not present; in both cases the right-most X-Forwarded-For entry is the
 * only one the directly-connected proxy vouches for — left-most entries are
 * client-controlled and trivially spoofable, so they must never be used for
 * rate limiting or audit attribution.
 */
export function getClientIp(headers: Headers | { get(name: string): string | null }): string {
  const edgeHeader = headers.get("x-blockwise-client-ip")?.trim();
  if (edgeHeader && isPlausibleIp(edgeHeader)) {
    return edgeHeader;
  }

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
