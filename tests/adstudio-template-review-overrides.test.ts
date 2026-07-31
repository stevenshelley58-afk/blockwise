import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTemplateReviewOverride,
  findTypographyKeyWithoutTextInput,
} from "../src/lib/adstudio/template-review-overrides.ts";

const baseTemplate = {
  id: "meta-feed-001",
  name: "Test",
  inputs: {
    text: [{ key: "headline", label: "Headline" }],
    images: [{ key: "hero" }],
  },
  typography: {
    headline: { fontId: "manrope", family: "Manrope" },
  },
};

test("applyTemplateReviewOverride replaces typography only when provided", () => {
  const merged = applyTemplateReviewOverride(baseTemplate, {
    typography: { headline: { fontId: "inter", family: "Inter" } },
  });
  assert.deepEqual(merged.typography, {
    headline: { fontId: "inter", family: "Inter" },
  });
  assert.deepEqual(merged.inputs, baseTemplate.inputs);
  assert.equal(merged.id, "meta-feed-001");
});

test("applyTemplateReviewOverride replaces inputs.text and preserves images", () => {
  const merged = applyTemplateReviewOverride(baseTemplate, {
    textInputs: [{ key: "headline" }, { key: "cta" }],
  });
  assert.deepEqual(merged.inputs.text, [{ key: "headline" }, { key: "cta" }]);
  assert.deepEqual(merged.inputs.images, [{ key: "hero" }]);
  // Original template stays untouched
  assert.equal(baseTemplate.inputs.text.length, 1);
});

test("applyTemplateReviewOverride with empty payload is a no-op", () => {
  const merged = applyTemplateReviewOverride(baseTemplate, {});
  assert.deepEqual(merged, baseTemplate);
});

test("findTypographyKeyWithoutTextInput flags orphan typography keys", () => {
  assert.equal(findTypographyKeyWithoutTextInput(baseTemplate), null);

  const orphaned = applyTemplateReviewOverride(baseTemplate, {
    textInputs: [{ key: "cta" }],
  });
  assert.equal(findTypographyKeyWithoutTextInput(orphaned), "headline");
});

test("findTypographyKeyWithoutTextInput handles missing shapes", () => {
  assert.equal(findTypographyKeyWithoutTextInput({}), null);
  assert.equal(
    findTypographyKeyWithoutTextInput({ typography: { headline: {} } }),
    "headline",
  );
});
