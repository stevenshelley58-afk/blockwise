import assert from "node:assert/strict";
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
