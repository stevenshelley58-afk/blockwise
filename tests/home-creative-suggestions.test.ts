import test from "node:test";
import assert from "node:assert/strict";
import { buildHomeCreativeSuggestions } from "../src/lib/home/creative-suggestions.ts";

const template = (templateId: string, importedAt: string, imageInputs = 1, textInputs = 1) => ({ templateId, name: templateId, importedAt, imageInputs, textInputs, feedLayout: {} as never, storyLayout: {} as never, semanticColours: {}, gallerySampleUrl: `/api/adstudio/templates/${templateId}/sample?placement=feed`, description: "", leadType: "other" as const });

test("first-ad suggestions prefer the simplest starter and cap at three", () => {
  const result = buildHomeCreativeSuggestions({ templates: [template("complex", "2026-09-08", 3, 3), template("simple-new", "2026-09-01", 0, 1), template("simple-old", "2026-08-01", 0, 1), template("fourth", "2026-07-01")], usedTemplateIds: new Set(), hasCreatedAds: false, usageReadSucceeded: true });
  assert.equal(result.audience, "first_ad");
  assert.deepEqual(result.items.map((item) => item.templateId), ["simple-new", "simple-old", "fourth"]);
});

test("returning suggestions exclude every previously tried template and preserve deep links", () => {
  const result = buildHomeCreativeSuggestions({ templates: [template("used", "2026-09-08"), template("new", "2026-09-01")], usedTemplateIds: new Set(["used"]), hasCreatedAds: true, usageReadSucceeded: true });
  assert.equal(result.audience, "returning");
  assert.equal(result.items[0]?.href, "/ad-studio/templates/new");
  assert.match(result.items[0]?.previewUrl ?? "", /sample/);
});

test("catalog empty, exhausted, and read failures are truthful", () => {
  assert.equal(buildHomeCreativeSuggestions({ templates: [], usedTemplateIds: new Set(), hasCreatedAds: false, usageReadSucceeded: true }).status, "empty");
  assert.equal(buildHomeCreativeSuggestions({ templates: [template("used", "2026-09-08")], usedTemplateIds: new Set(["used"]), hasCreatedAds: true, usageReadSucceeded: true }).status, "exhausted");
  assert.deepEqual(buildHomeCreativeSuggestions({ templates: [], usedTemplateIds: new Set(), hasCreatedAds: false, usageReadSucceeded: false }), { audience: "unknown", status: "unavailable", items: [] });
});

test("existing ads without a mapped template never look like a first-time user", () => {
  const result = buildHomeCreativeSuggestions({ templates: [template("available", "2026-09-08")], usedTemplateIds: new Set(), hasCreatedAds: true, usageReadSucceeded: true });
  assert.equal(result.audience, "returning");
  assert.equal(result.status, "ready");
});
