import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { renderAuthoritativeTextEdit, resolveAuthoritativeFontPath } from "../src/lib/adstudio/text-layers.ts";
import type { AdStudioTextLayerStyle } from "../src/lib/adstudio/types.ts";

const editRoute = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");

const style: AdStudioTextLayerStyle = {
  fontId: "Manrope",
  family: "Manrope",
  fontFile: "/fonts/adstudio/manrope-400.woff2",
  fallbackFamily: "sans-serif",
  weight: 400,
  italic: false,
  case: "upper",
  sizeRatio: 0.5,
  lineHeight: 1,
  tracking: 0.02,
  color: "#ffffff",
  align: "center",
  fitScore: 1,
  sampleLineCount: 1,
  sample: "ORIGINAL",
  maxLength: 24,
  mode: "live",
};

async function solidImage(): Promise<string> {
  const { default: sharp } = await import("sharp");
  const bytes = await sharp({
    create: { width: 240, height: 300, channels: 4, background: { r: 20, g: 38, b: 62, alpha: 1 } },
  }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function rawHash(dataUrl: string): Promise<string> {
  const { default: sharp } = await import("sharp");
  const raw = await sharp(Buffer.from(dataUrl.split(",")[1]!, "base64")).ensureAlpha().raw().toBuffer();
  return createHash("sha256").update(raw).digest("hex");
}

test("arbitrary browser patch bytes cannot influence saved server text pixels or QA", async () => {
  const current = await solidImage();
  const edit = {
    currentAssetUrl: current,
    plateAssetUrl: current,
    box: { x: 0.1, y: 0.15, width: 0.8, height: 0.16 },
    style,
    text: "exact text",
  };
  // These are intentionally not accepted by the renderer. They may be shown
  // optimistically in the browser, but the saved image comes only from `edit`.
  const arbitraryClientPatchBytes = [
    "data:image/png;base64,not-a-real-png",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+8jQZEwAAAABJRU5ErkJggg==",
  ];
  const saved = await Promise.all(arbitraryClientPatchBytes.map(() => renderAuthoritativeTextEdit(edit)));
  assert.equal(new Set(await Promise.all(saved.map(rawHash))).size, 1);
  assert.notEqual(await rawHash(saved[0]!), await rawHash(current));
  // The route records only the exact requested text after the server renderer
  // has succeeded; patchImage is no longer an API field at all.
  assert.match(editRoute, /copyValues:[\s\S]*\[editFieldKey\]: newValue/);
  assert.doesNotMatch(editRoute, /compositeTextPatch|client-typeset|patchImage/);
});

test("overlong and non-fitting text fail before any new finished image can be produced", async () => {
  const current = await solidImage();
  const input = {
    currentAssetUrl: current,
    plateAssetUrl: current,
    box: { x: 0.1, y: 0.15, width: 0.8, height: 0.16 },
    style,
  };
  await assert.rejects(
    renderAuthoritativeTextEdit({ ...input, text: "X".repeat(style.maxLength + 1) }),
    /24 characters or less/,
  );
  await assert.rejects(
    renderAuthoritativeTextEdit({ ...input, text: "ONE TWO THREE FOUR FIVE" }),
    /does not fit this area/,
  );
  assert.match(editRoute, /return errorResponse\(error, 400\)/);
  assert.ok(
    editRoute.indexOf("renderAuthoritativeTextEdit({") < editRoute.indexOf("persistCloneRender({"),
    "a failed authoritative render must return before a new revision asset is persisted",
  );
});

test("authoritative fonts cannot escape the bundled self-hosted directory", () => {
  assert.throws(
    () => resolveAuthoritativeFontPath({ ...style, fontFile: "/fonts/adstudio/../../package.json" }),
    /approved text font is unavailable/,
  );

  const link = join(process.cwd(), "public/fonts/adstudio/.server-text-authority-escape.woff2");
  symlinkSync("/etc/hosts", link);
  try {
    assert.throws(
      () => resolveAuthoritativeFontPath({ ...style, fontFile: "/fonts/adstudio/.server-text-authority-escape.woff2" }),
      /approved text font is unavailable/,
    );
  } finally {
    unlinkSync(link);
  }
});

test("a valid exact text value produces one server-rendered revision candidate", async () => {
  const current = await solidImage();
  const image = await renderAuthoritativeTextEdit({
    currentAssetUrl: current,
    plateAssetUrl: current,
    box: { x: 0.1, y: 0.15, width: 0.8, height: 0.16 },
    style,
    text: "exact text",
  });
  assert.match(image, /^data:image\/png;base64,/);
  assert.match(editRoute, /appendAdStudioCreativeRevision/);
  assert.match(editRoute, /provider: "server-typeset"/);
});
