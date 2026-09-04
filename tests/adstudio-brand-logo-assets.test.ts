import assert from "node:assert/strict";
import test from "node:test";

import { storeBrandKitLogoAssets } from "../src/lib/adstudio/brand-logo-assets.server.ts";
import { buildAdStudioFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function brandKit() {
  const kit = buildAdStudioFallbackBrandKit({
    workspaceId: "workspace-logo-test",
    workspaceName: "Logo Test",
  });
  kit.source = {
    type: "website",
    url: "https://agency.example.org",
    lastExtractedAt: new Date().toISOString(),
    pagesScanned: ["https://agency.example.org"],
  };
  kit.logos.primaryLogoUrl = "https://agency.example.org/media/logo.png";
  return kit;
}

test("stores an extracted logo behind the authenticated same-origin media route", async () => {
  const uploads: Array<{ path: string; contentType: string }> = [];
  const response = {
    ok: true,
    status: 200,
    url: "https://agency.example.org/media/logo.png",
    headers: new Headers({ "content-type": "image/png" }),
    body: new Response(ONE_PIXEL_PNG).body,
    arrayBuffer: async () => ONE_PIXEL_PNG.buffer,
  } as Response;
  const result = await storeBrandKitLogoAssets({
    brandKit: brandKit(),
    fetcher: async () => response,
    supabase: {
      storage: {
        from: () => ({
          upload: async (path, _body, options) => {
            uploads.push({ path, contentType: options.contentType });
            return { error: null };
          },
          download: async () => ({ data: null, error: { message: "not called" } }),
        }),
      },
    },
  });

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.contentType, "image/png");
  assert.match(uploads[0]?.path ?? "", /^workspace-logo-test\/brand\/[^/]+\/extracted-primary-[a-f0-9]{64}\.png$/);
  assert.match(result.brandKit.logos.primaryLogoUrl ?? "", /^\/api\/adstudio\/media\?path=/);
  assert.deepEqual(result.warnings, []);
});

test("does not fetch a cross-origin logo discovered in untrusted page HTML", async () => {
  const kit = brandKit();
  kit.logos.primaryLogoUrl = "https://cdn.example.net/logo.png";
  let fetched = false;
  const result = await storeBrandKitLogoAssets({
    brandKit: kit,
    fetcher: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
    supabase: {
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          download: async () => ({ data: null, error: null }),
        }),
      },
    },
  });

  assert.equal(fetched, false);
  assert.equal(result.brandKit.logos.primaryLogoUrl, "https://cdn.example.net/logo.png");
  assert.deepEqual(result.warnings, ["primary: source is not on the website origin"]);
});
