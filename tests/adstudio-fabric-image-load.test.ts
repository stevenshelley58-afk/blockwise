import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getFabricImageLoadOptions } from "../src/lib/adstudio/fabric-image-load.ts";

test("Ad Studio Fabric image loading keeps credentials for authenticated same-origin media", () => {
  const baseUrl = "https://app.blockwise.com/ad-studio";

  assert.equal(
    getFabricImageLoadOptions("/api/adstudio/media?path=workspace%2Fadstudio%2Fphoto.jpg", baseUrl),
    undefined,
  );
  assert.equal(
    getFabricImageLoadOptions("https://app.blockwise.com/api/adstudio/media?path=workspace%2Fphoto.jpg", baseUrl),
    undefined,
  );
});

test("Ad Studio Fabric image loading does not add CORS to local previews", () => {
  assert.equal(getFabricImageLoadOptions("blob:https://app.blockwise.com/preview-id"), undefined);
  assert.equal(getFabricImageLoadOptions("data:image/jpeg;base64,abc123"), undefined);
});

test("Ad Studio Fabric image loading keeps anonymous CORS for external images", () => {
  assert.deepEqual(
    getFabricImageLoadOptions("https://cdn.example.com/listing.jpg", "https://app.blockwise.com/ad-studio"),
    { crossOrigin: "anonymous" },
  );
});

test("browser export renderer reuses the same image credential policy", () => {
  const renderer = readFileSync("src/components/adstudio/canvas/browser-creative-renderer.ts", "utf8");

  assert.match(renderer, /getFabricImageLoadOptions/);
  assert.match(renderer, /const options = getFabricImageLoadOptions\(src\)/);
  assert.match(renderer, /if \(options\?\.crossOrigin\) image\.crossOrigin = options\.crossOrigin/);
});

test("browser export renderer does not fall back to oversized inline data", () => {
  const renderer = readFileSync("src/components/adstudio/canvas/browser-creative-renderer.ts", "utf8");

  assert.match(renderer, /return uploadCreativeRenders\(pack, renders\);/);
  assert.doesNotMatch(renderer, /falling back to inline render data/);
});

test("browser export renderer honours the template's declared visual properties", () => {
  const renderer = readFileSync("src/components/adstudio/canvas/browser-creative-renderer.ts", "utf8");

  assert.match(renderer, /object\.weight \?\?/);
  assert.match(renderer, /object\.align === "center"/);
  assert.match(renderer, /object\.lineHeight \?\?/);
  assert.match(renderer, /object\.radius \?\? 0/);
  assert.match(renderer, /object\.opacity \?\? 1/);
  assert.match(renderer, /object\.clip === "circle"/);
  assert.match(renderer, /object\.clip === "arch"/);
  assert.match(renderer, /horizontalAnchor\(object\.imageAnchor\)/);
  assert.match(renderer, /verticalAnchor\(object\.imageAnchor\)/);
  assert.match(renderer, /if \(object\.fontFamily\) return object\.fontFamily/);
});

test("Ad Studio export blocks when any required raster render fails", () => {
  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");

  assert.doesNotMatch(actions, /Creative render failed — please retry/);
  assert.match(actions, /Creative render failed/);
  assert.doesNotMatch(actions, /SVG fallback used for/);
  assert.match(actions, /map\(stripFabricJson\)/);
  assert.match(actions, /previewSvg: ""/);
});
