/**
 * Server-side redirects must target the public canonical origin. Behind the
 * VPS proxy chain the request URL resolves to the internal bind address
 * (e.g. http://0.0.0.0:3000), which is not reachable by browsers and is not
 * in the GoTrue redirect allow list. NEXT_PUBLIC_SITE_URL is the configured
 * public origin; the request origin is only a local-development fallback.
 */
export function publicOrigin(requestUrl: string | URL): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.endsWith("/") ? configured.slice(0, -1) : configured;
  }
  return new URL(requestUrl).origin;
}
