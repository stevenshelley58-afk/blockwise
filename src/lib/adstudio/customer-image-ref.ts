export const CUSTOMER_IMAGE_PREFIX = "/api/adstudio/customer-media?";
export const CUSTOMER_IMAGE_BUCKET = "adstudio-customer-images";
const MIME_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type CustomerImageMime = keyof typeof MIME_EXTENSIONS;

export function buildCustomerImageRef(workspaceId: string, adId: string, sha256: string, mime: CustomerImageMime): string {
  const path = `${workspaceId}/adstudio/ads/${adId}/images/${sha256}.${MIME_EXTENSIONS[mime]}`;
  return `${CUSTOMER_IMAGE_PREFIX}workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}&sha256=${sha256}&mime=${encodeURIComponent(mime)}`;
}

export function parseCustomerImageRef(value: string, workspaceId: string, adId: string): { path: string; sha256: string; mime: CustomerImageMime } | null {
  if (!value.startsWith(CUSTOMER_IMAGE_PREFIX)) return null;
  const params = new URLSearchParams(value.slice(CUSTOMER_IMAGE_PREFIX.length));
  const keys = [...params.keys()];
  if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some((key) => !["workspaceId", "path", "sha256", "mime"].includes(key))) return null;
  if (params.get("workspaceId") !== workspaceId) return null;
  const path = params.get("path") ?? "";
  const sha256 = params.get("sha256") ?? "";
  const mime = params.get("mime") as CustomerImageMime;
  const prefix = `${workspaceId}/adstudio/ads/${adId}/images/`;
  if (!isSafePathSegment(workspaceId) || !isSafePathSegment(adId)) return null;
  if (path !== `${prefix}${sha256}.${MIME_EXTENSIONS[mime]}` || path.includes("..") || !/^[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(path.slice(prefix.length))) return null;
  if (!/^[a-f0-9]{64}$/i.test(sha256) || !Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mime)) return null;
  if (!path.startsWith(`${prefix}${sha256}.`)) return null;
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (MIME_EXTENSIONS[mime] !== extension) return null;
  return { path, sha256: sha256.toLowerCase(), mime };
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
