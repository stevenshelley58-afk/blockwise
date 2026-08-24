import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

import { CustomerImageValidationError, validateCustomerImageDataUrl } from "../../src/lib/adstudio/image-validation.ts";

const png = await readFile("tests/fixtures/adstudio-v2/public/slots/photo-portrait.png");
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("customer image validation", () => {
  it("accepts valid PNG, WebP, and JPEG payloads", async () => {
    const webp = await sharp(png).webp().toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    for (const [mime, bytes] of [["image/png", png], ["image/webp", webp], ["image/jpeg", jpeg]] as const) {
      assert.equal((await validateCustomerImageDataUrl(dataUrl(mime, bytes))).length, bytes.length);
    }
  });

  it("rejects malformed data URLs and bad base64", async () => {
    await assert.rejects(validateCustomerImageDataUrl("data:image/png;base64,not-valid?"), (error: unknown) =>
      error instanceof CustomerImageValidationError && error.reason === "data_url_format");
    await assert.rejects(validateCustomerImageDataUrl("data:image/png;base64,A"), (error: unknown) =>
      error instanceof CustomerImageValidationError && error.reason === "base64");
  });

  it("rejects mismatched magic bytes and oversized payloads", async () => {
    await assert.rejects(validateCustomerImageDataUrl(dataUrl("image/jpeg", png)), (error: unknown) =>
      error instanceof CustomerImageValidationError && error.reason === "magic_bytes");
    const oversized = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
    await assert.rejects(validateCustomerImageDataUrl(dataUrl("image/png", oversized)), (error: unknown) =>
      error instanceof CustomerImageValidationError && error.reason === "size");
  });
});
