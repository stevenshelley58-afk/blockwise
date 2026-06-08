import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("asset upload UI supports picker, drop, paste, previews, and editable-target guards", () => {
  const dropzone = readFileSync("src/components/asset-upload-dropzone.tsx", "utf8");
  const newAdDialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const mediaPanel = readFileSync("src/components/adstudio/panels/media-panel.tsx", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  const mediaHook = readFileSync("src/components/adstudio/use-media.ts", "utf8");
  const onboarding = readFileSync("src/components/onboarding/onboarding-wizard.tsx", "utf8");
  const brandStudio = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");
  const globals = readFileSync("src/app/globals.css", "utf8");

  assert.match(dropzone, /type="file"/);
  assert.match(dropzone, /onDrop=\{handleDrop\}/);
  assert.match(dropzone, /onPaste=\{\(event/);
  assert.match(dropzone, /window\.addEventListener\("paste"/);
  assert.match(dropzone, /isEditableEventTarget/);
  assert.match(dropzone, /previewUrl \? <img/);
  assert.match(newAdDialog, /<AssetUploadDropzone[\s\S]*capturePagePaste/);
  assert.match(mediaPanel, /<AssetUploadDropzone[\s\S]*onFileAccepted=\{onUploadImage\}/);
  assert.match(workbench, /void handleUploadImage\(event\.target\.files\?\.\[0\]\)/);
  assert.match(mediaHook, /uploadRequestRef/);
  assert.match(mediaHook, /isCurrentUpload/);
  assert.match(mediaHook, /committedPrimaryImageRef/);
  assert.match(workbench, /getVariantPrimaryImage/);
  assert.match(workbench, /variantImage\?\.src/);
  assert.match(globals, /studio-newad-upload\[data-has-file="true"\]/);
  assert.match(globals, /studio-media-upload\[data-has-file="true"\]/);
  assert.match(onboarding, /<AssetUploadDropzone[\s\S]*Upload logo/);
  assert.match(brandStudio, /workspace-artifacts/);
  assert.match(brandStudio, /\/api\/adstudio\/brand-kits\/\$\{kit\.brandKitId\}\/assets/);
});

test("upload file names are sanitized before storage paths are built", () => {
  assert.equal(sanitizeUploadFileName("My Logo FINAL (Blue).svg"), "my-logo-final--blue-.svg");
});
