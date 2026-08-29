import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_IMAGE_MAX_BYTES,
  AD_IMAGE_UPLOAD_TYPES,
  LOGO_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  sanitizeUploadFileName,
  validateAssetUploadFile,
} from "../src/lib/upload/asset-file.ts";

const imageConstraints = {
  acceptedTypes: AD_IMAGE_UPLOAD_TYPES,
  maxBytes: AD_IMAGE_MAX_BYTES,
  typeError: "Use a JPG, PNG, or WebP image.",
  sizeError: "Use an image under 8 MB.",
};

test("asset upload validation accepts supported image MIME types and extension fallback", () => {
  assert.equal(validateAssetUploadFile({ name: "snip.png", type: "image/png", size: 1200 }, imageConstraints), null);
  assert.equal(validateAssetUploadFile({ name: "listing.JPG", type: "", size: 1200 }, imageConstraints), null);
});

test("asset upload validation rejects unsupported types and oversized logos", () => {
  assert.equal(
    validateAssetUploadFile({ name: "animation.gif", type: "image/gif", size: 1200 }, imageConstraints),
    "Use a JPG, PNG, or WebP image.",
  );
  assert.equal(
    validateAssetUploadFile(
      { name: "huge-logo.svg", type: "image/svg+xml", size: LOGO_MAX_BYTES + 1 },
      {
        acceptedTypes: LOGO_UPLOAD_TYPES,
        maxBytes: LOGO_MAX_BYTES,
        typeError: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB.",
        sizeError: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB.",
      },
    ),
    "Upload a PNG, JPG, WebP, or SVG logo under 5 MB.",
  );
});

test("upload file names are sanitized before storage paths are built", () => {
  assert.equal(sanitizeUploadFileName("My Logo FINAL (Blue).svg"), "my-logo-final--blue-.svg");
});
