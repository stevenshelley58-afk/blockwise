import assert from "node:assert/strict";
import test from "node:test";

import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";
import {
  AD_SYSTEM_CLONE_CONTRACT,
  GLOBAL_CLONE_NEGATIVES,
  PHOTO_FIT_RULE,
  buildCloneImageRequest,
  buildTargetedEditRequest,
  resolveCloneCopy,
} from "../src/lib/adstudio/reference-clone.ts";
import { buildTemplateCloneRequestsByFormat } from "../src/lib/adstudio/generate-template-campaign.ts";

const template = AD_STUDIO_TEMPLATES.find((entry) => entry.id === "meta-feed-020")!;
const images = {
  property_photo: "data:image/png;base64,PROPERTY",
  brand_logo: "data:image/png;base64,LOGO",
};

test("gallery samples and customer ads use the same clone request builder", () => {
  const sample = buildCloneImageRequest(template, {
    referenceImage: "data:image/png;base64,PRIVATE_SOURCE",
    images,
  });
  const customer = buildCloneImageRequest(template, {
    referenceImage: template.sample.imageSrc,
    images,
  });

  assert.equal(sample.prompt, customer.prompt);
  assert.equal(sample.negativePrompt, customer.negativePrompt);
  assert.deepEqual(sample.referenceAssets.slice(1), customer.referenceAssets.slice(1));
  assert.equal(sample.referenceAssets[0], "data:image/png;base64,PRIVATE_SOURCE");
  assert.equal(customer.referenceAssets[0], template.sample.imageSrc);
});
test("reference order is design first, then declared customer assets", () => {
  const request = buildCloneImageRequest(template, { images });
  assert.deepEqual(request.referenceAssets, [template.sample.imageSrc, images.property_photo, images.brand_logo]);
  assert.equal(request.requiresReferenceAssets, true);
  assert.equal(request.negativePrompt, GLOBAL_CLONE_NEGATIVES);
  assert.match(request.prompt, /Clone reference image 1 as closely as possible/);
  assert.ok(request.prompt.includes(AD_SYSTEM_CLONE_CONTRACT));
  assert.match(request.prompt, /pixel-level design blueprint/);
  assert.match(request.prompt, /template-applied effect/);
  assert.match(request.prompt, /fade, gradient, veil, overlay, shadow, reflection/);
  assert.match(request.prompt, /replacement image subject is intentionally different/);
  assert.match(request.prompt, /reference image slot is immovable/);
  assert.match(request.prompt, /Do not redesign, modernise, simplify/);
  const sectionHeadings = [
    "TASK",
    "DESIGN BLUEPRINT — REFERENCE IMAGE 1",
    "REFERENCE ASSETS — ORDER IS EXACT",
    "PHOTO FIT",
    "EXACT VISIBLE TEXT — USE NO OTHER TEXT",
    "COLOUR",
    "OUTPUT",
  ];
  assert.equal(request.prompt.startsWith("TASK\n"), true);
  for (let index = 1; index < sectionHeadings.length; index += 1) {
    assert.ok(
      request.prompt.indexOf(sectionHeadings[index - 1]) < request.prompt.indexOf(sectionHeadings[index]),
      `${sectionHeadings[index]} must follow ${sectionHeadings[index - 1]}`,
    );
  }
  assert.match(request.prompt, /REFERENCE ASSETS — ORDER IS EXACT\n- Reference image 1/u);
  assert.match(request.prompt, /EXACT VISIBLE TEXT — USE NO OTHER TEXT\n[\s\S]*\n- /u);
});

test("replacement wording and logos preserve the approved design footprint", () => {
  const request = buildCloneImageRequest(template, {
    referenceImage: "sample-image",
    images: { property_photo: "new-photo", brand_logo: "new-logo" },
    copy: { headline: "Different words", body: "Different supporting copy" },
  });
  assert.match(request.prompt, /text block's outer bounds, number of lines, line rhythm/u);
  assert.match(request.prompt, /logo's displayed bounding box, anchor, clear space, and visual weight/u);
});

test("copy is exact, defaulted from safe sample values, and max-length bounded", () => {
  const copy = resolveCloneCopy(template, { headline: "A headline that is much too long for this field" });
  assert.equal(copy.headline.length, 24);
  assert.equal(copy.price, "Offers from $895,000");
  const request = buildCloneImageRequest(template, { images, copy: { address: "45 REAL ST, PERTH WA" } });
  assert.match(request.prompt, /45 REAL ST, PERTH WA/);
  assert.match(request.prompt, /Use these exact visible text values and no others/);
  assert.match(request.prompt, /Customer asset replacement is mandatory/);
  assert.match(request.prompt, /render each value character-for-character exactly once/);
});

test("template colours are the default and preserve the approved sample palette", () => {
  const request = buildCloneImageRequest(template, { images });
  assert.match(request.prompt, /preserve the exact colour palette of reference image 1/i);
  assert.match(request.prompt, /Do not recolour the design to match the supplied logo or Brand Pack/i);
  assert.doesNotMatch(request.prompt, /adapt the design to this Brand Pack palette/i);
});

test("Brand Pack colours are applied only when the customer explicitly chooses them", () => {
  const request = buildCloneImageRequest(template, {
    images,
    colourSource: "brand",
    brandColours: ["primary #123456", "accent #FFCC00", "primary #123456"],
  });
  assert.match(request.prompt, /adapt the design to this Brand Pack palette/i);
  assert.match(request.prompt, /primary #123456, accent #FFCC00/);
  assert.match(request.prompt, /Preserve the reference design's contrast, hierarchy, typography, spacing, shapes, and image treatment/);
});

test("a rejected gallery candidate can feed one model-suggested correction back through the same clone builder", () => {
  const request = buildCloneImageRequest(template, {
    images,
    reviewCorrection: "Reduce the logo and match the quieter CTA treatment.",
  });
  assert.match(request.prompt, /PREVIOUS IMAGE-MODEL QA CORRECTION/);
  assert.match(request.prompt, /Reduce the logo and match the quieter CTA treatment/);
  assert.match(request.prompt, /do not authorize any other redesign/i);
  assert.deepEqual(request.referenceAssets, [template.sample.imageSrc, images.property_photo, images.brand_logo]);
});

test("supplied photos carry the fit rule: extend past edges instead of cropping the subject", () => {
  const request = buildCloneImageRequest(template, { images });
  assert.ok(request.prompt.includes(PHOTO_FIT_RULE));
  assert.match(request.prompt, /main subject stays completely in frame/);
  assert.match(request.prompt, /extend the photo by continuing its own scene naturally past its original edges/);
  assert.match(request.prompt, /crop only when the crop still shows the entire main subject/);
  assert.match(request.prompt, /photo area's position, width, height, mask, and boundary.*fixed/u);
  assert.match(request.prompt, /never resize or move that area/u);
  assert.match(GLOBAL_CLONE_NEGATIVES, /do not crop away the main subject of a supplied photo/);
  // The no-repaint negative must protect original content without banning edge extension.
  assert.match(GLOBAL_CLONE_NEGATIVES, /original visible content of supplied property photos/);
});

test("photo replacement edits carry the fit rule; text edits do not", () => {
  const imageEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "property photo",
    newValue: "",
    newImage: "data:image/png;base64,NEW_PROPERTY",
    aspectRatio: "4:5",
  });
  assert.ok(imageEdit.prompt.includes(PHOTO_FIT_RULE));

  const textEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "price",
    newValue: "$1,250,000",
    aspectRatio: "4:5",
  });
  assert.ok(!textEdit.prompt.includes(PHOTO_FIT_RULE));
});

test("missing required assets fail before any model request", () => {
  assert.throws(() => buildCloneImageRequest(template, { images: {} }), /Missing required image/);
});

test("feed and story are both clones anchored on the same approved sample", () => {
  const requests = buildTemplateCloneRequestsByFormat(template, { images });
  assert.equal(requests["4:5"].referenceAssets[0], template.sample.imageSrc);
  assert.equal(requests["9:16"].referenceAssets[0], template.sample.imageSrc);
  assert.equal(requests["4:5"].aspectRatio, "4:5");
  assert.equal(requests["9:16"].aspectRatio, "9:16");
  assert.match(requests["9:16"].prompt, /9:16/);
});

test("post-clone edits anchor on the current finished ad and change one target", () => {
  const textEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "price",
    newValue: "$1,250,000",
    expectedCopy: {
      headline: "JUST LISTED TODAY",
      price: "$1,250,000",
      website_handle: "SAMPLE TEXT",
    },
    aspectRatio: "4:5",
  });
  assert.deepEqual(textEdit.referenceAssets, ["data:image/png;base64,CURRENT"]);
  assert.match(textEdit.prompt, /Change only the price/);
  assert.match(textEdit.prompt, /Keep every other pixel unchanged/);
  assert.match(textEdit.prompt, /character-for-character exact/);
  assert.match(textEdit.prompt, /headline: "JUST LISTED TODAY"/);
  assert.match(textEdit.prompt, /website_handle: "SAMPLE TEXT"/);

  const imageEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "property photo",
    newValue: "",
    newImage: "data:image/png;base64,NEW_PROPERTY",
    aspectRatio: "4:5",
  });
  assert.deepEqual(imageEdit.referenceAssets, ["data:image/png;base64,CURRENT", "data:image/png;base64,NEW_PROPERTY"]);
  assert.match(imageEdit.prompt, /Replace only the property photo/);

  const promptedEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "property photo",
    newValue: "",
    editInstruction: "remove the parked car and brighten the garden",
    expectedCopy: { headline: "JUST LISTED TODAY" },
    aspectRatio: "4:5",
  });
  assert.deepEqual(promptedEdit.referenceAssets, ["data:image/png;base64,CURRENT"]);
  assert.match(promptedEdit.prompt, /remove the parked car and brighten the garden/);
  assert.match(promptedEdit.prompt, /Change only the property photo/);
  assert.match(promptedEdit.prompt, /headline: "JUST LISTED TODAY"/);
});
