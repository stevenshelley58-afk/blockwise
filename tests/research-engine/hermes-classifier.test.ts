import assert from "node:assert/strict";
import test from "node:test";

import * as classifierModule from "../../hermes/tools/research-runtime/bin/ad-classifier.mjs";

import {
  CLASSIFIER_VERSION,
  classifyCreativeDeterministically,
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

test("Hermes deterministic fallback separates seller guides from sold results", () => {
  const sellerGuide = classifyCreativeDeterministically({
    headline: "Selling Real Estate in Perth?",
    body: "This new real estate book shows you how to Sell for Top Dollar. Every single day homes are sold too cheaply.",
    cta: "Download",
  });
  const soldResult = classifyCreativeDeterministically({
    headline: "SOLD VIA AUCTION",
    body: "7 Namoi Court sold under the hammer for $1,410,000 with 8 registered bidders.",
    cta: "Learn more",
  });

  assert.equal(sellerGuide.ad_type, "agency_brand");
  assert.equal(soldResult.ad_type, "just_sold");
});

test("Hermes deterministic fallback treats unless-sold-prior copy as listing or open home", () => {
  const classification = classifyCreativeDeterministically({
    headline: "FOR SALE || 83 Milne Street, Bayswater",
    body: "End Date Sale - all offers by Tuesday unless sold prior. Home opens Saturday 12:00pm-1:00pm.",
    cta: "Learn more",
  });

  assert.equal(classification.ad_type, "open_home");
  assert.notEqual(classification.ad_type, "just_sold");
});

test("Hermes deterministic fallback classifies address-led property videos as listings", () => {
  const classification = classifyCreativeDeterministically({
    body: "3 Sandford Ave Lake Coogee. Beautiful family home in prime location. A Must See",
    cta: "Call now",
  });

  assert.equal(classification.ad_type, "listing");
  assert.equal(classification.primary_intent, "listing");
  assert.equal(classification.is_real_estate_ad, true);
});

test("Hermes deterministic fallback keeps address-led retail home ads out of listings", () => {
  const classification = classifyCreativeDeterministically({
    headline: "Huge Home Furniture Sale",
    body: "Visit 23 Example Street Osborne Park for sofas, dining tables, mattresses and homewares.",
    cta: "Shop now",
  });

  assert.equal(classification.ad_type, "other");
  assert.equal(classification.is_real_estate_ad, false);
});

test("Hermes deterministic fallback classifies auction address copy as listing", () => {
  const classification = classifyCreativeDeterministically({
    body: "56 Holland Street, Wembley. Auction on site 27th June. 653m2 development site.",
    cta: "Learn more",
  });

  assert.equal(classification.ad_type, "listing");
  assert.equal(classification.primary_intent, "listing");
});

test("Hermes deterministic fallback classifies appraisal and property management copy", () => {
  assert.equal(
    classifyCreativeDeterministically({
      headline: "See How Much Your Home Is Worth",
      body: "Tap Learn More for a free detailed market report and price update.",
      cta: "Learn more",
    }).ad_type,
    "appraisal",
  );
  assert.equal(
    classifyCreativeDeterministically({
      headline: "How Much Is Your Property Manager Really Costing You?",
      body: "Request a free rental price check and review your property management fees.",
      cta: "See details",
    }).ad_type,
    "property_management",
  );
});

test("Hermes classifier uses vision classification when copy is missing and media is captured", async () => {
  const calls: Array<{ body: { model: string; messages: Array<{ content: unknown }> } }> = [];
  const result = await classifyCreativeWithModels(
    { id: "creative-1", headline: null, body: null, cta: null, format: "image" },
    [{ kind: "image", url: "https://cdn.example.test/ad.jpg", storage_path: "ad.jpg" }],
    {
      env: {
        OPENROUTER_API_KEY: "test-key",
        HERMES_OPENROUTER_MODELS_JSON: JSON.stringify({
          ad_classification: "text-model",
          vision_classification: "vision-model",
        }),
      },
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        // First call: image download from CDN
        if (String(url).includes("cdn.example.test")) {
          return new Response(Buffer.alloc(2048, 0xff), {
            headers: { "content-type": "image/jpeg" },
          });
        }
        // Second call: LLM API
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

  assert.equal(result.model, "vision-model");
  assert.equal(result.evidenceSource, "vision");
  assert.equal(result.classification.ad_type, "listing");
  assert.equal(result.classification.classifier_version, CLASSIFIER_VERSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.model, "vision-model");
  assert.ok(JSON.stringify(calls[0]?.body.messages).includes("image_url"));
});

test("Hermes classifier falls back after model failures while recording fallback metadata", async () => {
  const result = await classifyCreativeWithModels(
    {
      id: "creative-2",
      headline: "What is your property worth in today's market?",
      body: "Get an accurate price update before you list.",
      cta: "Learn more",
    },
    [],
    {
      env: {
        OPENROUTER_API_KEY: "test-key",
        HERMES_OPENROUTER_MODELS_JSON: JSON.stringify({ ad_classification: "text-model" }),
      },
      fetchImpl: async (): Promise<Response> => {
        throw new Error("model unavailable");
      },
    },
  );

  assert.equal(result.model, "deterministic-fallback");
  assert.equal(result.evidenceSource, "fallback");
  assert.equal(result.classification.ad_type, "appraisal");
  assert.equal(result.classification.classifier_version, CLASSIFIER_VERSION);
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
