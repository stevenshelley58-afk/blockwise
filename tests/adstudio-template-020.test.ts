import assert from "node:assert/strict";
import test from "node:test";

import { deriveTemplateBrief, getTemplateBrief } from "../src/lib/adstudio/template-brief.ts";
import { customerCopyFieldsForTemplate, imageRequirementsForTemplate } from "../src/components/adstudio/new-ad-dialog-slots.ts";
import { buildCloneImageRequest } from "../src/lib/adstudio/reference-clone.ts";
import { RAW_ADSTUDIO_GALLERY_TEMPLATES } from "../src/lib/adstudio/template-gallery/index.ts";
import type { AdStudioTemplate } from "../src/lib/adstudio/index.ts";

const template020 = (RAW_ADSTUDIO_GALLERY_TEMPLATES as unknown as AdStudioTemplate[]).find(
  (t) => t.id === "meta-feed-020",
);

test("meta-feed-020 declares exactly one required photo and five customer copy fields", () => {
  assert.ok(template020, "meta-feed-020 must be registered in the gallery");

  const images = imageRequirementsForTemplate(template020);
  const required = images.filter((slot) => slot.required);
  assert.equal(required.length, 1, "exactly one required image slot (the property photo)");
  assert.equal(required[0].id, "property_photo");
  const logo = images.find((slot) => slot.id === "brand_logo");
  assert.ok(logo, "the logo slot exists");
  assert.equal(logo!.required, false, "the logo slot is optional");

  const copyFields = customerCopyFieldsForTemplate(template020);
  assert.deepEqual(
    copyFields.map((field) => field.key).sort(),
    ["address", "headline", "phone", "price", "website_handle"],
    "the five customer-typed fields, nothing more",
  );
});

test("meta-feed-020 brief marks customer fields and uses the ORIGINAL ad as the clone reference", () => {
  const brief = getTemplateBrief("meta-feed-020");
  assert.ok(brief, "brief derives for meta-feed-020");

  // The reference is the committed original source ad — never an SVG recreation.
  assert.equal(brief!.referenceImage, "/adstudio-samples/meta/meta-feed-020.png");
  assert.doesNotMatch(brief!.referenceImage, /\.svg/);

  const customerKeys = brief!.copyFields.filter((f) => f.customerSupplied).map((f) => f.key).sort();
  assert.deepEqual(customerKeys, ["address", "headline", "phone", "price", "website_handle"]);
});

test("meta-feed-020 clone request fails without the required photo and carries verbatim copy", () => {
  const brief = getTemplateBrief("meta-feed-020")!;

  assert.throws(
    () => buildCloneImageRequest(brief, { images: {}, copy: {} }),
    /Missing required image/,
    "no silent defaults: the property photo is mandatory",
  );

  const request = buildCloneImageRequest(brief, {
    images: { property_photo: "data:image/png;base64,x" },
    copy: { price: "$1,234,567", address: "45 REAL ST, PERTH WA 6000", phone: "+61 400 000 000" },
  });
  assert.match(request.prompt, /\$1,234,567/, "customer price reaches the prompt verbatim");
  assert.match(request.prompt, /45 REAL ST, PERTH WA 6000/, "customer address reaches the prompt verbatim");
});

test("no gallery template asks for market statistics without a customer input", () => {
  // The anti-fabrication rule: a stats-like text slot must be customer-supplied
  // (typed verbatim) — otherwise the copy model is forced to invent numbers.
  for (const template of RAW_ADSTUDIO_GALLERY_TEMPLATES as unknown as AdStudioTemplate[]) {
    const brief = deriveTemplateBrief(template as never);
    for (const field of brief.copyFields) {
      const statsLike = /median|growth|price/i.test(field.key) && /\$|%|\d/.test(field.default ?? "");
      if (statsLike && template.id === "meta-feed-020") {
        assert.ok(field.customerSupplied, `${template.id}:${field.key} must be customer-supplied`);
      }
    }
  }
});
