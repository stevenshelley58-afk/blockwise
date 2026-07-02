// Image providers (OpenAI edits, Gemini) accept only JPEG/PNG/WebP inputs,
// but the template gallery samples are SVG files — sending one straight
// through fails with "unsupported mimetype ('image/svg+xml')". Rasterize SVG
// references to a PNG data URL server-side before any provider sees them.

// Warm-lambda cache: the same gallery sample is cloned over and over.
const rasterCache = new Map<string, string>();
const RASTER_CACHE_MAX = 32;

export async function ensureRasterReferenceImage(reference: string): Promise<string> {
  const trimmed = reference.trim();

  if (trimmed.startsWith("data:")) {
    if (!/^data:image\/svg/i.test(trimmed)) return trimmed;
    return rasterizeSvg(trimmed, svgDataUrlToBuffer(trimmed));
  }

  let pathname: string;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    return trimmed;
  }
  if (!/\.svg$/i.test(pathname)) return trimmed;

  const cached = rasterCache.get(trimmed);
  if (cached) return cached;

  const response = await fetch(trimmed);
  if (!response.ok) {
    throw new Error(`Reference image could not be fetched (${response.status}).`);
  }
  return rasterizeSvg(trimmed, Buffer.from(await response.arrayBuffer()));
}

function svgDataUrlToBuffer(dataUrl: string): Buffer {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return dataUrl.includes(";base64,")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
}

async function rasterizeSvg(cacheKey: string, svg: Buffer): Promise<string> {
  // Dynamic import keeps sharp (a native module) out of any client/edge bundle.
  const { default: sharp } = await import("sharp");
  const png = await sharp(svg).png().toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  if (rasterCache.size >= RASTER_CACHE_MAX) {
    const oldest = rasterCache.keys().next().value;
    if (oldest !== undefined) rasterCache.delete(oldest);
  }
  rasterCache.set(cacheKey, dataUrl);
  return dataUrl;
}
