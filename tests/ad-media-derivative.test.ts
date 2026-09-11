import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import {
  AD_MEDIA_DERIVATIVE_WIDTH,
  adMediaDerivative,
  derivativeFormat,
  resetAdMediaDerivativeCache,
  shouldDerivative,
} from "../src/lib/research/ad-media-derivative.ts";

const base = { method: "GET", range: null, contentType: "image/png", contentLength: 4_700_305 };

test("a large image on a plain GET is downscaled", () => {
  assert.equal(shouldDerivative(base), true);
  assert.equal(shouldDerivative({ ...base, method: "HEAD" }), false);
});

test("Range requests and videos keep streaming untouched", () => {
  // The grid shows videos through the same route, and the browser asks for byte
  // ranges of them. Re-encoding a range request would break playback.
  assert.equal(shouldDerivative({ ...base, range: "bytes=0-1023" }), false);
  assert.equal(shouldDerivative({ ...base, contentType: "video/mp4", contentLength: 10_382_027 }), false);
  assert.equal(shouldDerivative({ ...base, contentType: null }), false);
  assert.equal(shouldDerivative({ ...base, contentType: "image/svg+xml", contentLength: 900_000 }), false);
});

test("images that are already small, or implausibly large, pass through", () => {
  assert.equal(shouldDerivative({ ...base, contentLength: 84_387 }), false);
  assert.equal(shouldDerivative({ ...base, contentLength: 0 }), false);
  assert.equal(shouldDerivative({ ...base, contentLength: 20 * 1024 * 1024 }), false);
});

test("the encoder follows the client's Accept header", () => {
  assert.equal(derivativeFormat("image/avif,image/webp,*/*"), "webp");
  assert.equal(derivativeFormat("image/png,image/jpeg"), "jpeg");
  assert.equal(derivativeFormat(null), "jpeg");
});

test("a derivative is smaller than its source, bounded in width, and cached", async () => {
  resetAdMediaDerivativeCache();
  const source = await sharp({
    create: {
      width: 2048,
      height: 2048,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma: 30 },
    },
  })
    .png()
    .toBuffer();

  const first = await adMediaDerivative("ad:media", new Uint8Array(source), "webp");
  const metadata = await sharp(Buffer.from(first.body)).metadata();

  assert.equal(first.contentType, "image/webp");
  assert.equal(metadata.width, AD_MEDIA_DERIVATIVE_WIDTH);
  assert.ok(first.body.byteLength < source.byteLength, "derivative should be smaller than the source");

  // The same media id twice must not re-encode: the grid requests the same card
  // again after a remount, and a second pass would burn CPU for identical bytes.
  const second = await adMediaDerivative("ad:media", new Uint8Array(source), "webp");
  assert.equal(second, first);

  // Concurrent callers share one render as well.
  resetAdMediaDerivativeCache();
  const [left, right] = await Promise.all([
    adMediaDerivative("ad:other", new Uint8Array(source), "webp"),
    adMediaDerivative("ad:other", new Uint8Array(source), "webp"),
  ]);
  assert.equal(left, right);
});

test("the proxy uses the derivative and still falls back to the original", () => {
  const route = readFileSync("src/app/api/research/ads/[adId]/media/[mediaId]/route.ts", "utf8");

  assert.match(route, /shouldDerivative\(/);
  assert.match(route, /adMediaDerivative\(/);
  // Range and video traffic still streams straight through.
  assert.match(route, /range: request\.headers\.get\("range"\)/);
  assert.match(route, /buffered \?\? upstream\.body/);
  // A failed resize must not lose the image.
  assert.match(route, /media derivative failed, serving the original/);
  // The derivative response must not claim byte-range support it cannot honour.
  assert.doesNotMatch(route, /derivativeHeaders[\s\S]{0,400}accept-ranges/);
});
