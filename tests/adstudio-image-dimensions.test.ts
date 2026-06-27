import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { imageDimensionsFromBytes, imageDimensionsFromDataUrl } from "../src/lib/adstudio/image-dimensions.ts";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set([(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff], 16);
  bytes.set([(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff], 20);
  return bytes;
}

test("imageDimensionsFromBytes reads PNG IHDR width/height", () => {
  assert.deepEqual(imageDimensionsFromBytes(pngHeader(1280, 720)), { width: 1280, height: 720 });
});

test("imageDimensionsFromBytes reads JPEG SOF0 width/height", () => {
  // SOI, SOF0 marker, length(17), precision(8), height(720), width(1280), ...
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00, 0x00]);
  assert.deepEqual(imageDimensionsFromBytes(jpeg), { width: 1280, height: 720 });
});

test("imageDimensionsFromBytes returns null for non-image bytes", () => {
  assert.equal(imageDimensionsFromBytes(new Uint8Array([1, 2, 3, 4])), null);
});

test("imageDimensionsFromDataUrl decodes a base64 png data URL", () => {
  const dataUrl = `data:image/png;base64,${Buffer.from(pngHeader(1080, 1350)).toString("base64")}`;
  assert.deepEqual(imageDimensionsFromDataUrl(dataUrl), { width: 1080, height: 1350 });
});

test("imageDimensionsFromDataUrl returns null for non-data refs", () => {
  assert.equal(imageDimensionsFromDataUrl("/api/adstudio/media?path=x.jpg"), null);
});
