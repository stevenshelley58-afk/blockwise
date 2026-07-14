import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  customerCopyFieldsForTemplate,
  defaultImageForTemplateSlot,
  imageRequirementsForTemplate,
} from "../src/components/adstudio/new-ad-dialog-slots.ts";
import { buildCloneImageRequest } from "../src/lib/adstudio/reference-clone.ts";
import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

const template = AD_STUDIO_TEMPLATES.find((item) => item.id === "meta-feed-020")!;

test("meta-feed-020 declares the customer assets and exact text inputs", () => {
  assert.ok(template);
  assert.deepEqual(imageRequirementsForTemplate(template).map((slot) => [slot.id, slot.required]), [
    ["property_photo", true],
    ["brand_logo", true],
  ]);
  assert.deepEqual(customerCopyFieldsForTemplate(template).map((field) => field.key), [
    "headline", "price", "address", "phone", "website_handle",
  ]);
});
test("the gallery displays a generated sample, never the private source ad", () => {
  const sampleBytes = readFileSync(`public${template.sample.imageSrc}`);
  const sourceBytes = readFileSync(`meta_ad_candidates/${template.sourceAd.file}`);
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(sampleBytes), template.sample.contentHash);
  assert.equal(hash(sourceBytes), template.sourceAd.contentHash);
  assert.notEqual(template.sample.contentHash, template.sourceAd.contentHash);
  assert.equal(template.sample.generatedBy, "reference_clone");
});

test("a brand-kit logo may prefill the declared logo input", () => {
  const logo = imageRequirementsForTemplate(template).find((slot) => slot.id === "brand_logo")!;
  assert.equal(defaultImageForTemplateSlot(logo, {
    logos: { primaryLogoUrl: "/brand/blockwise-logo.svg", darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
  }), "/brand/blockwise-logo.svg");
});

test("clone generation fails closed without either required asset", () => {
  assert.throws(() => buildCloneImageRequest(template, { images: {} }), /Property image, Agency logo/);
  const request = buildCloneImageRequest(template, {
    images: { property_photo: "data:image/png;base64,PHOTO", brand_logo: "data:image/png;base64,LOGO" },
    copy: { price: "$1,234,567", address: "45 REAL ST, PERTH WA 6000" },
  });
  assert.match(request.prompt, /\$1,234,567/);
  assert.match(request.prompt, /45 REAL ST, PERTH WA 6000/);
});
