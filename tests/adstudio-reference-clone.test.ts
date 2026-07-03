import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_CLONE_NEGATIVES,
  buildCloneImageRequest,
  resolveCloneCopy,
  type TemplateCloneBrief,
} from "../src/lib/adstudio/reference-clone.ts";
import { buildTemplateCloneRequestsByFormat } from "../src/lib/adstudio/generate-template-campaign.ts";

const brief: TemplateCloneBrief = {
  templateId: "test-tpl",
  name: "Test",
  aspectRatio: "4:5",
  referenceImage: "data:image/png;base64,REF",
  imageSlots: [
    { role: "hero_property_photo", required: true, description: "the hero photo" },
    { role: "agent_headshot", required: false, description: "the agent portrait" },
  ],
  copyFields: [
    { key: "headline", label: "Headline", maxLength: 10, default: "Default HL" },
    { key: "cta", label: "CTA", default: "View" },
  ],
  brandHex: "#1f9e8f",
  clonePrompt: 'Clone it. headline="{headline}" cta="{cta}" colour {brandHex}.',
};

test("reference order: design first, then supplied images in slot order", () => {
  const req = buildCloneImageRequest(brief, {
    images: { hero_property_photo: "data:image/png;base64,HERO", agent_headshot: "data:image/png;base64,FACE" },
  });
  assert.deepEqual(req.referenceAssets, [
    "data:image/png;base64,REF",
    "data:image/png;base64,HERO",
    "data:image/png;base64,FACE",
  ]);
  assert.equal(req.requiresReferenceAssets, true);
  assert.equal(req.aspectRatio, "4:5");
  assert.equal(req.negativePrompt, GLOBAL_CLONE_NEGATIVES);
});

test("optional slot omitted → only design + hero", () => {
  const req = buildCloneImageRequest(brief, { images: { hero_property_photo: "data:image/png;base64,HERO" } });
  assert.equal(req.referenceAssets.length, 2);
  assert.match(req.prompt, /Reference image 1 = the finished ad design/);
  assert.match(req.prompt, /Reference image 2 = the hero photo/);
  assert.doesNotMatch(req.prompt, /Reference image 3/);
});

test("copy is interpolated, defaulted, and truncated to maxLength", () => {
  const req = buildCloneImageRequest(brief, {
    images: { hero_property_photo: "x" },
    copy: { headline: "This headline is far too long to fit" },
  });
  assert.match(req.prompt, /headline="This headl"/); // maxLength 10
  assert.match(req.prompt, /cta="View"/); // default applied
  assert.match(req.prompt, /colour #1f9e8f/);
});

test("brand hex override is honoured", () => {
  const req = buildCloneImageRequest(brief, { images: { hero_property_photo: "x" }, brandHex: "#ff0000" });
  assert.match(req.prompt, /colour #ff0000/);
});

test("template campaign builds feed and story clone requests with the same verbatim copy", () => {
  const requests = buildTemplateCloneRequestsByFormat(brief, {
    images: { hero_property_photo: "data:image/png;base64,HERO" },
    copy: { headline: "just isted", cta: "Call now" },
    brandHex: "#ff0000",
  });

  assert.equal(requests["4:5"].aspectRatio, "4:5");
  assert.equal(requests["9:16"].aspectRatio, "9:16");
  assert.match(requests["9:16"].prompt, /Recompose this exact ad design as a 9:16 vertical story/);
  for (const request of [requests["4:5"], requests["9:16"]]) {
    assert.match(request.prompt, /headline="just isted"/);
    assert.match(request.prompt, /cta="Call now"/);
    assert.match(request.prompt, /colour #ff0000/);
  }
});

test("global clone negatives forbid leaking reference contact details", () => {
  assert.match(GLOBAL_CLONE_NEGATIVES, /replace every phone number, URL, handle, and contact detail/i);
  assert.match(GLOBAL_CLONE_NEGATIVES, /never keep the reference's contact details/i);
  assert.match(GLOBAL_CLONE_NEGATIVES, /never invent new ones/i);
});

test("missing required image throws", () => {
  assert.throws(() => buildCloneImageRequest(brief, { images: { agent_headshot: "x" } }), /Missing required image/);
});

test("reference image can be overridden per request", () => {
  const req = buildCloneImageRequest(brief, {
    images: { hero_property_photo: "x" },
    referenceImage: "https://example.com/other-design.png",
  });
  assert.equal(req.referenceAssets[0], "https://example.com/other-design.png");
});

test("resolveCloneCopy throws when a field has no value and no default", () => {
  const noDefault: TemplateCloneBrief = { ...brief, copyFields: [{ key: "headline", label: "Headline" }] };
  assert.throws(() => resolveCloneCopy(noDefault, {}), /Missing copy/);
});

test("brief without a clonePrompt uses the generic builder and interpolates copy", () => {
  const dataOnly: TemplateCloneBrief = { ...brief, clonePrompt: undefined };
  const req = buildCloneImageRequest(dataOnly, {
    images: { hero_property_photo: "data:image/png;base64,HERO" },
    copy: { headline: "Hi", cta: "Go" },
  });
  assert.match(req.prompt, /Recreate the attached REFERENCE ad design/);
  assert.match(req.prompt, /"Hi"/);
  assert.match(req.prompt, /"Go"/);
  assert.doesNotMatch(req.prompt, /\{[a-z_]+\}/i);
});
