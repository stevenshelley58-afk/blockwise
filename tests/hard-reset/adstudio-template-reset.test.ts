import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  RESOLVABLE_AD_STUDIO_TEMPLATES,
  builtInAdStudioTemplates,
  resolveAdStudioTemplate,
  resolvableAdStudioTemplates,
} from "../../src/lib/adstudio/index.ts";
import { validateQualityLockIndex } from "../../src/lib/adstudio/templates.ts";
import qualityLocks from "../../src/lib/adstudio/template-gallery/quality-locks.json" with { type: "json" };

const forbidden = ["canvas", "fabricJson", "gallery", "templateKey", "promptHint", "version"];

test("the installed gallery exposes one unversioned sample-and-input contract", () => {
  assert.equal(builtInAdStudioTemplates().length, RESOLVABLE_AD_STUDIO_TEMPLATES.length);
  assert.equal(resolvableAdStudioTemplates().length, RESOLVABLE_AD_STUDIO_TEMPLATES.length);
  assert.equal(new Set(AD_STUDIO_TEMPLATES.map((template) => template.id)).size, AD_STUDIO_TEMPLATES.length);
  for (const template of AD_STUDIO_TEMPLATES) {
    assert.equal(template.status, "approved");
    assert.equal(template.sample.generatedBy, "reference_clone");
    assert.notEqual(template.sample.contentHash, template.sourceAd.contentHash);
    assert.ok(template.inputs.images.some((field) => field.required));
    const serialized = JSON.stringify(template);
    for (const key of forbidden) assert.equal(serialized.includes(`"${key}"`), false, `${template.id} contains ${key}`);
  }
  for (const template of RESOLVABLE_AD_STUDIO_TEMPLATES) {
    assert.equal(resolveAdStudioTemplate(template.id)?.id, template.id);
  }
  const unlocked = AD_STUDIO_TEMPLATES.filter(
    (template) => !RESOLVABLE_AD_STUDIO_TEMPLATES.some((candidate) => candidate.id === template.id),
  );
  for (const template of unlocked) assert.equal(resolveAdStudioTemplate(template.id), null);
});
test("unknown templates fail closed", () => {
  assert.equal(resolveAdStudioTemplate("missing-template"), null);
});

test("runtime rejects a stale lock when the current manifest contract changes", () => {
  const released = RESOLVABLE_AD_STUDIO_TEMPLATES[0]!;
  const changed = { ...released, name: `${released.name} changed after QA` };
  const result = validateQualityLockIndex(qualityLocks, [changed]);
  assert.equal(result.templateIds.has(changed.id), false);
  assert.match(result.issues.join("\n"), /templateContract does not match the current manifest/u);
});

test("runtime keeps a valid lock when production rewrites equivalent floating-point geometry", () => {
  const released = RESOLVABLE_AD_STUDIO_TEMPLATES.find(
    (template) => template.id === "meta-agent-intro-feed-037",
  )!;
  const locks = structuredClone(qualityLocks);
  const lock = locks.templates[released.id as keyof typeof locks.templates];
  const stored = JSON.parse(lock.templateContract) as { dimensions: { height: number } };
  stored.dimensions.height += Number.EPSILON * stored.dimensions.height * 4;
  lock.templateContract = JSON.stringify(stored);

  const result = validateQualityLockIndex(locks, [released]);
  assert.equal(result.templateIds.has(released.id), true);
  assert.equal(result.issues.some((issue) => issue.includes(released.id)), false);
});

test("the manifest contract accepts templates with deterministicOnly: true", () => {
  // At least one template in the gallery is marked deterministicOnly.
  // The in-memory contract must not reject it.
  const deterministic = AD_STUDIO_TEMPLATES.filter(
    (t) => (t as Record<string, unknown>).deterministicOnly === true,
  );
  assert.ok(deterministic.length > 0, "expected at least one deterministicOnly template in the gallery");
  for (const t of deterministic) {
    assert.equal(t.status, "approved");
  }
});

test("deterministicOnly is optional for manifests regardless of release selection", () => {
  const nonDeterministic = AD_STUDIO_TEMPLATES.filter(
    (t) => !(t as Record<string, unknown>).deterministicOnly,
  );
  assert.ok(nonDeterministic.length > 0, "expected at least one template without deterministicOnly");
  for (const t of nonDeterministic) {
    assert.equal(t.status, "approved");
  }
});
