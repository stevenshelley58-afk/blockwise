import assert from "node:assert/strict";
import test from "node:test";

import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";
import {
  GLOBAL_CLONE_NEGATIVES,
  buildCloneImageRequest,
  buildTargetedEditRequest,
  resolveCloneCopy,
} from "../src/lib/adstudio/reference-clone.ts";
import { buildTemplateCloneRequestsByFormat } from "../src/lib/adstudio/generate-template-campaign.ts";

const template = AD_STUDIO_TEMPLATES[0]!;
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
});

test("copy is exact, defaulted from safe sample values, and max-length bounded", () => {
  const copy = resolveCloneCopy(template, { headline: "A headline that is much too long for this field" });
  assert.equal(copy.headline.length, 24);
  assert.equal(copy.price, "Offers from $895,000");
  const request = buildCloneImageRequest(template, { images, copy: { address: "45 REAL ST, PERTH WA" } });
  assert.match(request.prompt, /45 REAL ST, PERTH WA/);
  assert.match(request.prompt, /Use these exact visible text values and no others/);
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
    aspectRatio: "4:5",
  });
  assert.deepEqual(textEdit.referenceAssets, ["data:image/png;base64,CURRENT"]);
  assert.match(textEdit.prompt, /Change only the price/);
  assert.match(textEdit.prompt, /Keep every other pixel unchanged/);

  const imageEdit = buildTargetedEditRequest({
    currentImage: "data:image/png;base64,CURRENT",
    fieldLabel: "property photo",
    newValue: "",
    newImage: "data:image/png;base64,NEW_PROPERTY",
    aspectRatio: "4:5",
  });
  assert.deepEqual(imageEdit.referenceAssets, ["data:image/png;base64,CURRENT", "data:image/png;base64,NEW_PROPERTY"]);
  assert.match(imageEdit.prompt, /Replace only the property photo/);
});
