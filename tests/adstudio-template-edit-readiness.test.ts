import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  deterministicEditingReadiness,
  validateGalleryTemplate,
  type AdStudioTemplate,
} from "../src/lib/adstudio/templates.ts";

function fixture(): AdStudioTemplate {
  return structuredClone(AD_STUDIO_TEMPLATES[0]!);
}

function makeDeterministic(template: AdStudioTemplate): AdStudioTemplate {
  const sourceSpec = Object.values(template.typography ?? {})[0]!;
  template.typography = Object.fromEntries(template.inputs.text.map((input, index) => {
    const sampleBox = { x: 0.1, y: 0.05 + index * 0.045, width: 0.4, height: 0.04 };
    return [input.key, {
      ...sourceSpec,
      measurementVersion: 2,
      measurementSource: "ocr-v2",
      fitScore: 0.9,
      detectionScore: 0.9,
      fontFile: sourceSpec.fontFile ?? "/fonts/adstudio/merriweather-500.woff2",
      sampleBox,
      sampleLineCount: 1,
      measuredLines: [{ text: input.sample, sampleBox, sizeRatio: 0.8 }],
    }];
  }));
  template.deterministicEditing = {
    status: "ready",
    imageBoxes: Object.fromEntries(template.inputs.images.map((input) => [input.key, {
      x: 0.1, y: 0.25, width: 0.8, height: 0.5,
    }])),
  };
  return template;
}

test("readiness distinguishes legacy, partial, and fully deterministic template evidence", () => {
  const legacy = fixture();
  delete legacy.typography;
  delete legacy.deterministicEditing;
  assert.deepEqual(deterministicEditingReadiness(legacy), {
    status: "legacy",
    issues: [],
  });

  const partial = fixture();
  delete partial.deterministicEditing;
  assert.equal(deterministicEditingReadiness(partial).status, "partial");

  const ready = makeDeterministic(fixture());
  assert.deepEqual(deterministicEditingReadiness(ready), { status: "ready", issues: [] });
});

test("an explicitly ready template cannot omit a text treatment or image hitbox", () => {
  const template = makeDeterministic(fixture());
  const missingText = template.inputs.text[0]!.key;
  const missingImage = template.inputs.images[0]!.key;
  delete template.typography![missingText];
  delete template.deterministicEditing!.imageBoxes[missingImage];

  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.some((issue) => issue.includes(`text input ${missingText} has no typography spec`)));
  assert.ok(readiness.issues.some((issue) => issue.includes(`image input ${missingImage} has no valid editor hitbox`)));
  assert.throws(() => validateGalleryTemplate(template), /has no typography spec.*has no valid editor hitbox/u);
});

test("an explicitly ready template requires trustworthy self-hosted text treatments", () => {
  const template = makeDeterministic(fixture());
  const key = template.inputs.text[0]!.key;
  template.typography![key] = {
    ...template.typography![key]!,
    fitScore: 0.2,
    fontFile: undefined,
  };

  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.some((issue) => issue.includes(`text input ${key} does not meet the confidence threshold`)));
  assert.ok(readiness.issues.some((issue) => issue.includes(`text input ${key} has no self-hosted fontFile`)));
});

test("an explicitly ready template rejects legacy text sizing measurements", () => {
  const template = makeDeterministic(fixture());
  const key = template.inputs.text[0]!.key;
  delete template.typography![key]!.measurementVersion;

  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.some((issue) => issue.includes(`text input ${key} uses a legacy typography measurement`)));
  assert.throws(() => validateGalleryTemplate(template), /legacy typography measurement/u);
});

test("an explicitly ready template requires verified measurement provenance", () => {
  const template = makeDeterministic(fixture());
  const key = template.inputs.text[0]!.key;
  delete template.typography![key]!.measurementSource;

  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.some((issue) => issue.includes(`text input ${key} has no verified measurement provenance`)));
});

test("an explicitly ready template rejects overlapping text hitboxes", () => {
  const template = makeDeterministic(fixture());
  const [first, second] = template.inputs.text;
  assert.ok(first && second);
  template.typography![second.key]!.sampleBox = {
    ...template.typography![first.key]!.sampleBox,
  };

  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.some((issue) => issue.includes(`text inputs ${first.key} and ${second.key} have overlapping editor boxes`)));
});

test("a partial template may persist verified image boxes while its remaining text is rebuilt", () => {
  const template = fixture();
  const image = template.inputs.images[0]!;
  template.deterministicEditing = {
    status: "partial",
    imageBoxes: {
      [image.key]: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 },
    },
  };
  delete template.typography![template.inputs.text[0]!.key];

  assert.doesNotThrow(() => validateGalleryTemplate(template));
  const readiness = deterministicEditingReadiness(template);
  assert.equal(readiness.status, "partial");
  assert.ok(readiness.issues.length > 0);
});
