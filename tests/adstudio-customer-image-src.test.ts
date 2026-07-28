import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateFirstAd } from "../src/lib/adstudio/first-ad-input.ts";
import {
  classifyAdStudioImageSrc,
  isAdStudioImageSrc,
  isTransientImagePreview,
  storagePathFromMediaSrc,
  workspaceMediaSrc,
} from "../src/lib/adstudio/image-src.ts";
import { loadAdStudioLibraryPage } from "../src/lib/adstudio/library-read-model.ts";
import type { FirstAdInput } from "../src/lib/adstudio/types.ts";

const WORKSPACE = "workspace-1";
const STORAGE_PATH = `${WORKSPACE}/adstudio/kit-1/uuid-front-of-house.jpg`;
const MEDIA_SRC = `/api/adstudio/media?path=${encodeURIComponent(STORAGE_PATH)}`;
const SIGNED_URL =
  "https://project.supabase.co/storage/v1/render/image/sign/workspace-artifacts/" +
  "workspace-1/adstudio/kit-1/uuid-front-of-house.jpg?token=ey.signed&width=640";

function firstAd(overrides: Partial<FirstAdInput> = {}): FirstAdInput {
  return {
    source: "gallery",
    templateId: "meta-feed-020",
    description: "Fresh coastal-style home in Scarborough.",
    imageDataUrl: MEDIA_SRC,
    formats: ["9:16", "4:5"],
    ...overrides,
  } as FirstAdInput;
}

test("every source the customer can pick is classified once, for client and server alike", () => {
  assert.equal(classifyAdStudioImageSrc(MEDIA_SRC), "workspace-media");
  assert.equal(classifyAdStudioImageSrc("data:image/png;base64,iVBORw0KGgo="), "inline");
  assert.equal(classifyAdStudioImageSrc("/adstudio-samples/meta/meta-feed-020-sample.png"), "builtin");
  assert.equal(classifyAdStudioImageSrc("/ads/ad-hillview.jpg"), "builtin");
  // Listing-portal photos and Brand Pack assets kept at their source_url.
  assert.equal(classifyAdStudioImageSrc("https://i2.au.reastatic.net/listing/photo.jpg"), "remote");
});

test("sources the generator cannot use are refused", () => {
  for (const src of [
    undefined,
    "",
    "   ",
    "blob:https://app.blockwise.com/6f1d-4a2b", // upload still in flight
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://insecure.example.com/photo.jpg", // reaches third-party providers; TLS only
    "/api/adstudio/media?path=", // proxy shape with nothing behind it
    "https://localhost/photo.jpg",
    "https://metadata.internal/photo.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/photo.jpg",
    "https://[::1]/photo.jpg",
    "https://cdn.example.com/brand-logo.svg", // would require a customer-controlled server-side fetch
    "https://cdn.example.com/brand-logo.SVG?version=2",
    SIGNED_URL, // our own bucket, signed: expires, and this one is a 640px render
  ]) {
    assert.equal(isAdStudioImageSrc(src), false, `expected ${String(src)} to be refused`);
  }
});

test("a blob preview is named as an unfinished upload, not a broken image", () => {
  assert.equal(isTransientImagePreview("blob:https://app.blockwise.com/6f1d"), true);
  assert.equal(isTransientImagePreview(MEDIA_SRC), false);
});

test("workspace media sources round-trip and stay workspace-scoped", () => {
  assert.equal(workspaceMediaSrc(WORKSPACE, STORAGE_PATH), MEDIA_SRC);
  assert.equal(storagePathFromMediaSrc(MEDIA_SRC), STORAGE_PATH);
  assert.equal(workspaceMediaSrc(WORKSPACE, "other-workspace/adstudio/kit-1/photo.jpg"), null);
  assert.equal(workspaceMediaSrc(WORKSPACE, `${WORKSPACE}/../secrets/photo.jpg`), null);
  assert.equal(workspaceMediaSrc("", STORAGE_PATH), null);
});

/**
 * The regression this suite exists for: the library used to hand the New Ad
 * dialog its signed 640px thumbnail, which the campaigns route refused with
 * "Add a required image before generating the ad" — so "Choose from library"
 * could never produce an ad.
 */
test("a library asset carries a generation source the campaigns route accepts", async () => {
  const page = await loadAdStudioLibraryPage({
    supabase: fakeLibraryClient(),
    workspaceId: WORKSPACE,
    kind: "assets",
  });

  const [asset] = page.items as Array<{ src: string; fullSrc: string }>;
  assert.ok(asset);
  // The grid still shows the cheap signed render...
  assert.equal(asset.src, SIGNED_URL);
  assert.equal(isAdStudioImageSrc(asset.src), false);
  // ...while generation gets the durable, full-resolution original.
  assert.equal(asset.fullSrc, MEDIA_SRC);
  assert.equal(validateFirstAd(firstAd({ imageDataUrl: asset.fullSrc })), null);
});

test("the campaigns route accepts every source the dialog can produce", () => {
  const sources = {
    "fresh upload": MEDIA_SRC,
    "library pick": MEDIA_SRC,
    "listing-portal photo": "https://i2.au.reastatic.net/listing/photo.jpg",
    "brand pack logo at its source url": "https://harbourandkey.com.au/logo.png",
    "generated image": "data:image/png;base64,iVBORw0KGgo=",
  };
  for (const [name, src] of Object.entries(sources)) {
    assert.equal(validateFirstAd(firstAd({ imageDataUrl: src })), null, `${name} should generate`);
  }
});

test("a second required slot is validated the same way as the primary image", () => {
  assert.equal(
    validateFirstAd(
      firstAd({ imageDataUrls: { property_photo: MEDIA_SRC, brand_logo: "https://agency.example/logo.png" } }),
    ),
    null,
  );
  assert.match(
    validateFirstAd(
      firstAd({ imageDataUrls: { property_photo: MEDIA_SRC, brand_logo: "blob:https://app/6f1d" } }),
    ) ?? "",
    /still uploading/,
  );
});

test("each rejection tells the customer what to do next", () => {
  assert.match(validateFirstAd(firstAd({ imageDataUrl: "" })) ?? "", /Add a required image/);
  assert.match(validateFirstAd(firstAd({ imageDataUrl: "blob:https://app/6f1d" })) ?? "", /still uploading/);
  assert.match(validateFirstAd(firstAd({ imageDataUrl: SIGNED_URL })) ?? "", /Upload it again/);
});

test("the dialog blocks an unusable image before it can reach the server", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  // The library grid shows `src`; the ad is generated from `fullSrc`.
  assert.match(dialog, /setSlotImage\(activeImageSlot\.id, asset\.fullSrc, asset\.label\)/);
  assert.match(dialog, /!isTransientImagePreview\(src\) && !isAdStudioImageSrc\(src\)/);
  assert.match(dialog, /unusableImageLabels/);
});

test("the campaigns route owns no private notion of a valid image", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  assert.match(route, /validateFirstAd/);
  assert.doesNotMatch(route, /startsWith\("data:image\//);
  assert.doesNotMatch(route, /startsWith\("\/adstudio-samples\//);
});

/** Minimal Supabase stand-in: one stored asset row plus signed-URL generation. */
function fakeLibraryClient() {
  const row = {
    id: "asset-1",
    asset_type: "listing_image",
    storage_path: STORAGE_PATH,
    metadata_json: { fileName: "Front of house.jpg" },
    created_at: "2026-07-28T00:00:00.000Z",
  };
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    or: () => query,
    gt: () => query,
    data: [row],
    error: null,
  };
  return {
    from: () => query,
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: SIGNED_URL }, error: null }),
      }),
    },
  } as never;
}
