import sharp from "sharp";

/**
 * Downscaled derivatives for Ad Radar archive images.
 *
 * The Ad DB stores creatives as 2048px PNGs of 3.9-6.3 MB and its media
 * endpoint answers every resize parameter with identical bytes, so the grid used
 * to ship 57 MB for the twelve cards above the fold (measured on production with
 * a real browser). The proxy already streams every one of those bytes, so the
 * derivative is made here, once per media id, and kept in memory.
 *
 * Nothing here changes video or Range handling: only a plain GET of a large
 * image is touched, and any failure falls back to the original bytes.
 */
export const AD_MEDIA_DERIVATIVE_WIDTH = 1024;

/** Source images at or below this are already small enough to pass through. */
const MIN_SOURCE_BYTES = 120_000;

/** Above this the object is not an image worth buffering (videos are excluded by type anyway). */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/** Total bytes of derivatives kept in memory. 1024px WebP is typically 40-160 KB. */
const CACHE_BUDGET_BYTES = 32 * 1024 * 1024;

/** Ad Radar cards and the creative viewer both display below the derivative width. */
export type DerivativeFormat = "webp" | "jpeg";

type Derivative = { body: Uint8Array<ArrayBuffer>; contentType: string };

export type DerivativeDecision = {
  method: string;
  range: string | null;
  contentType: string | null;
  contentLength: number;
};

/**
 * True when the response should be replaced by a downscaled derivative.
 *
 * A `Range` request must stream untouched: the browser is asking for a slice of
 * a specific file, and answering with a re-encoded image would corrupt video
 * playback and byte-range reads.
 */
export function shouldDerivative(input: DerivativeDecision): boolean {
  if (input.method !== "GET") return false;
  if (input.range) return false;

  const contentType = (input.contentType ?? "").toLowerCase();
  // SVG is already small and must not be rasterised.
  if (contentType.includes("svg")) return false;
  if (!contentType.startsWith("image/")) return false;

  return input.contentLength > MIN_SOURCE_BYTES && input.contentLength <= MAX_SOURCE_BYTES;
}

/** `Accept` decides the encoder, so a client without WebP still gets a small image. */
export function derivativeFormat(accept: string | null): DerivativeFormat {
  return (accept ?? "").toLowerCase().includes("image/webp") ? "webp" : "jpeg";
}

const cache = new Map<string, Derivative>();
let cacheBytes = 0;
const inFlight = new Map<string, Promise<Derivative>>();

/** Bounded concurrency: a grid can ask for a dozen derivatives at once on a shared box. */
const MAX_CONCURRENT_RENDERS = 3;
let activeRenders = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  activeRenders += 1;
}

function releaseSlot(): void {
  activeRenders -= 1;
  waiting.shift()?.();
}

/**
 * The derivative for `key`, rendering at most once for concurrent callers and
 * serving repeats from memory.
 */
export async function adMediaDerivative(
  key: string,
  source: Uint8Array,
  format: DerivativeFormat,
): Promise<Derivative> {
  const cacheKey = `${key}\0${format}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    // Re-insert so the map's order stays least-recently-used first.
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const work = render(source, format)
    .then((derivative) => {
      remember(cacheKey, derivative);
      return derivative;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, work);
  return work;
}

function remember(key: string, derivative: Derivative): void {
  cache.set(key, derivative);
  cacheBytes += derivative.body.byteLength;
  while (cacheBytes > CACHE_BUDGET_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    cacheBytes -= evicted?.body.byteLength ?? 0;
  }
}

async function render(source: Uint8Array, format: DerivativeFormat): Promise<Derivative> {
  await acquireSlot();
  try {
    const resized = sharp(source, { failOn: "none" })
      .rotate()
      .resize({ width: AD_MEDIA_DERIVATIVE_WIDTH, withoutEnlargement: true });
    const body =
      format === "webp"
        ? await resized.webp({ quality: 72, effort: 4 }).toBuffer()
        : await resized.jpeg({ quality: 76, mozjpeg: true }).toBuffer();
    // Copied into an ArrayBuffer-backed view so the value is a plain BodyInit.
    const bytes = new Uint8Array(body.byteLength);
    bytes.set(body);
    return {
      body: bytes,
      contentType: format === "webp" ? "image/webp" : "image/jpeg",
    };
  } finally {
    releaseSlot();
  }
}

/** Test seam: clears the module caches so each case starts clean. */
export function resetAdMediaDerivativeCache(): void {
  cache.clear();
  inFlight.clear();
  cacheBytes = 0;
}
