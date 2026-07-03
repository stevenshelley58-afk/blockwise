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

test("browser export renderer falls back to inline data when storage upload fails", () => {
  const renderer = readFileSync("src/components/adstudio/canvas/browser-creative-renderer.ts", "utf8");

  assert.match(renderer, /try \{\s+return await uploadCreativeRenders\(pack, renders\);/);
  assert.match(renderer, /falling back to inline render data/);
  assert.match(renderer, /return renders;\s+\}/);
});
