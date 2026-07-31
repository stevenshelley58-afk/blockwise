import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  RESOLVABLE_AD_STUDIO_TEMPLATES,
  builtInAdStudioTemplates,
  resolveAdStudioTemplate,
  resolvableAdStudioTemplates,
} from "../../src/lib/adstudio/index.ts";

const forbidden = ["canvas", "fabricJson", "gallery", "templateKey", "promptHint", "version"];

test("the installed gallery exposes one unversioned sample-and-input contract", () => {
  assert.equal(builtInAdStudioTemplates().length, AD_STUDIO_TEMPLATES.length);
  assert.equal(resolvableAdStudioTemplates().length, RESOLVABLE_AD_STUDIO_TEMPLATES.length);
  assert.equal(new Set(AD_STUDIO_TEMPLATES.map((template) => template.id)).size, AD_STUDIO_TEMPLATES.length);
  for (const template of AD_STUDIO_TEMPLATES) {
    assert.equal(template.status, "approved");
    assert.equal(template.sample.generatedBy, "reference_clone");
    assert.notEqual(template.sample.contentHash, template.sourceAd.contentHash);
    assert.ok(template.inputs.images.some((field) => field.required));
    assert.equal(resolveAdStudioTemplate(template.id)?.id, template.id);
    const serialized = JSON.stringify(template);
    for (const key of forbidden) assert.equal(serialized.includes(`"${key}"`), false, `${template.id} contains ${key}`);
  }
});
test("unknown templates fail closed", () => {
  assert.equal(resolveAdStudioTemplate("missing-template"), null);
});

test("the gallery contract accepts templates with deterministicOnly: true", () => {
  // At least one template in the gallery is marked deterministicOnly.
  // The in-memory contract must not reject it.
  const deterministic = AD_STUDIO_TEMPLATES.filter(
    (t) => (t as Record<string, unknown>).deterministicOnly === true,
  );
  assert.ok(deterministic.length > 0, "expected at least one deterministicOnly template in the gallery");
  for (const t of deterministic) {
    assert.equal(t.status, "approved");
    assert.ok(resolveAdStudioTemplate(t.id), `${t.id} should be resolvable`);
  }
});

test("deterministicOnly is optional — templates without it still pass the contract", () => {
  const nonDeterministic = AD_STUDIO_TEMPLATES.filter(
    (t) => !(t as Record<string, unknown>).deterministicOnly,
  );
  assert.ok(nonDeterministic.length > 0, "expected at least one template without deterministicOnly");
  for (const t of nonDeterministic) {
    assert.equal(t.status, "approved");
    assert.ok(resolveAdStudioTemplate(t.id), `${t.id} should be resolvable`);
  }
});
