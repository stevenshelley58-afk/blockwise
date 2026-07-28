/**
 * The one contract for a customer-supplied image source in Ad Studio.
 *
 * Every surface that hands an image to the generator — the New Ad dialog, the
 * media library, the listing scrape, the Brand Pack — must produce a source
 * this module accepts, and the campaigns route validates with the same
 * predicate. Before this existed the route carried a private allowlist that
 * disagreed with what the library actually produced (signed Supabase URLs),
 * so "Choose from library" failed generation every time with
 * "Add a required image before generating the ad."
 *
 * Kinds:
 * - `inline`          a `data:image/...` URL (generated or pasted bytes)
 * - `workspace-media` `/api/adstudio/media?path=<workspace storage path>` —
 *                     the durable, full-resolution, auth-gated proxy. This is
 *                     the preferred form for anything we store: it never
 *                     expires and `resolveAdStudioImageForModel` streams the
 *                     original bytes straight out of the bucket.
 * - `builtin`         a shipped gallery sample or demo image.
 * - `remote`          a public `https://` image we do not host (listing-portal
 *                     photos, a Brand Pack logo kept at its `source_url`).
 *                     `resolveAdStudioImageForModel` passes these to the model
 *                     as-is, so they must be publicly fetchable.
 *
 * Signed storage URLs are deliberately NOT a kind of their own. They expire
 * (one hour) and the library signs a 640px render, so generating from one
 * would silently degrade the ad. Map storage-backed assets to
 * `workspaceMediaSrc()` instead — see `library-read-model.ts`.
 */

export type AdStudioImageSrcKind = "inline" | "workspace-media" | "builtin" | "remote";

export const ADSTUDIO_MEDIA_SRC_PREFIX = "/api/adstudio/media?";

const BUILTIN_PREFIXES = ["/adstudio-samples/", "/ads/"] as const;

/** Hosts a public image can never legitimately live on. Blocks the generator
 *  (and the SVG rasteriser, which fetches server-side) from being pointed at
 *  loopback, link-local, or private-network addresses. */
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".home.arpa"] as const;

/** Build the durable proxy source for a workspace storage path. */
export function workspaceMediaSrc(
  workspaceId: string,
  storagePath: string | null | undefined,
): string | null {
  const path = storagePath?.trim();
  if (!workspaceId || !path) return null;
  if (!path.startsWith(`${workspaceId}/`) || path.includes("..")) return null;
  return `${ADSTUDIO_MEDIA_SRC_PREFIX}path=${encodeURIComponent(path)}`;
}

/** Recover the storage path from a workspace media source. */
export function storagePathFromMediaSrc(src: string | null | undefined): string | null {
  const value = src?.trim();
  if (!value?.startsWith(ADSTUDIO_MEDIA_SRC_PREFIX)) return null;
  const query = value.slice(value.indexOf("?") + 1);
  const path = new URLSearchParams(query).get("path")?.trim();
  return path || null;
}

export function classifyAdStudioImageSrc(
  value: string | null | undefined,
): AdStudioImageSrcKind | null {
  const src = value?.trim();
  if (!src) return null;
  if (src.startsWith("data:image/")) return "inline";
  if (src.startsWith(ADSTUDIO_MEDIA_SRC_PREFIX)) {
    return storagePathFromMediaSrc(src) ? "workspace-media" : null;
  }
  if (BUILTIN_PREFIXES.some((prefix) => src.startsWith(prefix))) return "builtin";
  return isPublicHttpsImage(src) ? "remote" : null;
}

export function isAdStudioImageSrc(value: string | null | undefined): boolean {
  return classifyAdStudioImageSrc(value) !== null;
}

/**
 * `blob:` previews are the one invalid source worth naming: the dialog paints
 * one the instant a file is picked, and it means the upload has not landed yet.
 */
export function isTransientImagePreview(value: string | null | undefined): boolean {
  return Boolean(value?.trim().startsWith("blob:"));
}

function isPublicHttpsImage(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  // http:// is refused as well as the obvious javascript:/blob:/file: — a
  // customer image reaches third-party model providers, so it must be TLS.
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (isAddressLiteral(hostname)) return false;
  return !isSignedStorageUrl(url);
}

/**
 * A signed URL for our own bucket is refused on purpose. It expires within the
 * hour — long before an async generation may run — and the one the library
 * hands out is a 640px render, so accepting it would quietly generate the ad
 * from a thumbnail. Reference stored bytes by path (`workspaceMediaSrc`).
 */
function isSignedStorageUrl(url: URL): boolean {
  return url.pathname.includes("/storage/v1/") && url.pathname.includes("/sign/");
}

/**
 * Bare IP literals are refused outright rather than range-checked. No real
 * image host is addressed by IP, and a name-only rule cannot be defeated by
 * decimal, octal, or IPv4-mapped-IPv6 spellings of a private address.
 */
function isAddressLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || hostname.includes(":") || /^[\d.]+$/.test(hostname);
}
