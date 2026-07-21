import assert from "node:assert/strict";
import test from "node:test";

import * as classifierModule from "../../hermes/tools/research-runtime/bin/ad-classifier.mjs";

import {
  CLASSIFIER_VERSION,
  classifyCreativeWithModels,
  hasUnresolvedDynamicPlaceholder,
  hasUsableCapturedMedia,
  shouldReclassifyCreative,
  shouldDisplayClassifiedCreative,
  shouldWaitForMediaClassification,
} from "../../hermes/tools/research-runtime/bin/ad-classifier.mjs";

test("Hermes exposes a shared captured-image quality assessment", () => {
  assert.equal(typeof classifierModule.assessCapturedImageQuality, "function");
});

test("Hermes exposes an image dimensions reader for capture-time validation", () => {
  assert.equal(typeof classifierModule.readImageDimensions, "function");
});

test("Hermes reads JPEG, PNG, WebP, and HEIF dimensions without runtime image dependencies", async () => {
  const { default: sharp } = await import("sharp");
  const source = sharp({
    create: { width: 60, height: 80, channels: 3, background: { r: 255, g: 225, b: 0 } },
  });
  const [jpeg, png, webp] = await Promise.all([
    source.clone().jpeg().toBuffer(),
    source.clone().png().toBuffer(),
    source.clone().webp().toBuffer(),
  ]);
  const heif = Buffer.alloc(64);
  heif.write("ftyp", 4, "ascii");
  heif.writeUInt32BE(20, 8);
  heif.write("ispe", 12, "ascii");
  heif.writeUInt32BE(60, 20);
  heif.writeUInt32BE(80, 24);
  heif.writeUInt32BE(20, 32);
  heif.write("ispe", 36, "ascii");
  heif.writeUInt32BE(1920, 44);
  heif.writeUInt32BE(1280, 48);

  assert.deepEqual(classifierModule.readImageDimensions(jpeg, "image/jpeg"), { width: 60, height: 80 });
  assert.deepEqual(classifierModule.readImageDimensions(png, "image/png"), { width: 60, height: 80 });
  assert.deepEqual(classifierModule.readImageDimensions(webp, "image/webp"), { width: 60, height: 80 });
  assert.deepEqual(classifierModule.readImageDimensions(heif, "image/heif"), { width: 1920, height: 1280 });
});

test("Hermes rejects byte-sized and dimensionally tiny captured images", () => {
  assert.deepEqual(
    classifierModule.assessCapturedImageQuality({ byteSize: 902, width: 60, height: 60 }),
    { displayable: false, reason: "image_too_small" },
  );
  assert.deepEqual(
    classifierModule.assessCapturedImageQuality({ byteSize: 8_000, width: 80, height: 80 }),
    { displayable: false, reason: "image_dimensions_too_small" },
  );
});

test("Hermes accepts normal captured images and tolerates missing legacy dimensions", () => {
  assert.deepEqual(
    classifierModule.assessCapturedImageQuality({ byteSize: 85_000, width: 1080, height: 1080 }),
    { displayable: true, reason: null },
  );
  assert.deepEqual(
    classifierModule.assessCapturedImageQuality({ byteSize: 85_000, width: null, height: null }),
    { displayable: true, reason: null },
  );
});

test("Hermes classifier uses vision classification when copy is missing and media is captured", async () => {
  const calls: Array<{ body: { model: string; messages: Array<{ content: unknown }> } }> = [];
  const result = await classifyCreativeWithModels(
    { id: "creative-1", headline: null, body: null, cta: null, format: "image" },
    [{ kind: "image", url: "https://cdn.example.test/ad.jpg", storage_path: "ad.jpg" }],
    {
      env: {
        MOONSHOT_API_KEY: "test-key",
        HERMES_MODELS_JSON: JSON.stringify({
          ad_classification: "kimi-k2.6",
          vision_classification: "kimi-k2.5",
        }),
      },
      fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        calls.push({ body });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  adType: "listing",
                  primaryIntent: "promote_listing",
                  isRealEstateAd: true,
                  realEstateRelevance: "listing",
                  propertyOrAgentFocus: "property",
                  hooks: ["listing"],
                  confidence: 0.72,
                  rationale: "The image shows a property listing creative.",
                }),
              },
            },
          ],
        });
      },
    },
  );

  assert.equal(result.model, "kimi-k2.5");
  assert.equal(result.evidenceSource, "vision");
  assert.equal(result.classification.ad_type, "listing");
  assert.equal(result.classification.classifier_version, CLASSIFIER_VERSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.model, "kimi-k2.5");
  assert.ok(JSON.stringify(calls[0]?.body.messages).includes("image_url"));
});

test("Hermes classifier fails honestly after bounded direct-model attempts", async () => {
  let calls = 0;
  await assert.rejects(() => classifyCreativeWithModels(
    {
      id: "creative-2",
      headline: "What is your property worth in today's market?",
      body: "Get an accurate price update before you list.",
      cta: "Learn more",
    },
    [],
    {
      env: {
        MOONSHOT_API_KEY: "test-key",
        HERMES_MODELS_JSON: JSON.stringify({ ad_classification: "kimi-k2.6" }),
      },
      fetchImpl: async (): Promise<Response> => {
        calls += 1;
        throw new Error("model unavailable");
      },
    },
  ), /model unavailable/);
  assert.equal(calls, 2);
});

test("Hermes classifier backfill queues missing, weak, and stale-version classifications only", () => {
  assert.equal(shouldReclassifyCreative({ classification_status: "unclassified" }), true);
  assert.equal(shouldReclassifyCreative({ ad_type: "other", primary_intent: "other" }), true);
  assert.equal(shouldReclassifyCreative({ classification: { classifier_version: "old" }, ad_type: "listing" }), true);
  assert.equal(
    shouldReclassifyCreative({
      classification_status: "classified",
      classification: { classifier_version: CLASSIFIER_VERSION },
      ad_type: "listing",
      primary_intent: "listing",
    }),
    false,
  );
});

test("Hermes classifier waits for media when copy is unusable and media sources exist", () => {
  assert.equal(
    shouldWaitForMediaClassification(
      { headline: "", body: "", cta: "", primary_image_url: "https://cdn.example.test/source.jpg" },
      [],
    ),
    true,
  );
  assert.equal(
    shouldWaitForMediaClassification(
      { headline: "", body: "", cta: "", primary_image_url: "https://cdn.example.test/source.jpg" },
      [{ kind: "image", url: "https://cdn.example.test/captured.jpg" }],
    ),
    false,
  );
});

test("Hermes display gate rejects dynamic placeholders and known tiny media artifacts", () => {
  const classification = { is_real_estate_ad: true };

  assert.equal(hasUnresolvedDynamicPlaceholder({ headline: "{{product.name}}", body: "Agency brand" }), true);
  assert.equal(hasUsableCapturedMedia([{ kind: "image", storage_path: "tiny.jpg", byte_size: 645 }]), false);
  assert.equal(hasUsableCapturedMedia([{ kind: "video", storage_path: "ad.mp4", byte_size: 250_000 }]), true);

  assert.equal(
    shouldDisplayClassifiedCreative(
      { headline: "{{product.name}}", body: "Agency brand", format: "video" },
      [{ kind: "video", storage_path: "ad.mp4", byte_size: 250_000 }],
      classification,
    ),
    false,
  );
  assert.equal(
    shouldDisplayClassifiedCreative(
      { headline: "Real headline", body: "Agency brand", format: "video" },
      [{ kind: "image", storage_path: "tiny.jpg", byte_size: 645 }],
      classification,
    ),
    false,
  );
  assert.equal(
    shouldDisplayClassifiedCreative(
      { headline: "Real headline", body: "Agency brand", format: "video" },
      [{ kind: "video", storage_path: "ad.mp4", byte_size: 250_000 }],
      classification,
    ),
    true,
  );
});
