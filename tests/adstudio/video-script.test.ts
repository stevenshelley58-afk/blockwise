import assert from "node:assert/strict";
import test from "node:test";
import { generateDeterministicVideoScript } from "../../src/lib/adstudio/video/script.ts";
import { countWords, parseVideoProjectInput, validateVideoScriptPlan, VideoValidationError } from "../../src/lib/adstudio/video/validation.ts";

function input(durationSeconds: 15 | 30 = 15) {
  return parseVideoProjectInput({
    recipeId: "seller_education",
    audience: "Local homeowners",
    objective: "Generate seller leads",
    brief: { serviceArea: "Scarborough", offer: "a practical seller checklist" },
    durationSeconds,
    assets: [{ id: "logo-1", kind: "logo", url: "https://example.com/logo.png" }],
  });
}

test("deterministic script has three hooks, four scenes, bounded words and overlays", () => {
  for (const duration of [15, 30] as const) {
    const project = input(duration);
    const plan = generateDeterministicVideoScript(project);
    assert.equal(plan.hookVariants.length, 3);
    assert.equal(plan.scenes.length, 4);
    assert.equal(plan.source, "deterministic");
    assert.equal(plan.wordCount, countWords(`${plan.body} ${plan.cta}`));
    assert.ok(plan.wordCount >= (duration === 15 ? 30 : 60));
    assert.ok(plan.wordCount <= (duration === 15 ? 40 : 75));
    assert.ok(plan.scenes.every((scene) => countWords(scene.overlay) <= 7));
    assert.match(plan.body, /Scarborough/u);
  }
});

test("brief rejects unsupported claims and listing-sale copy", () => {
  assert.throws(() => parseVideoProjectInput({
    ...inputPayload(),
    objective: "We guarantee the number one valuation",
  }), VideoValidationError);
  assert.throws(() => parseVideoProjectInput({
    ...inputPayload(),
    brief: { serviceArea: "Scarborough", offer: "Open home this Saturday" },
  }), VideoValidationError);
});

test("script validator rejects long overlays and out-of-range spoken copy", () => {
  const project = input();
  const plan = generateDeterministicVideoScript(project);
  assert.throws(() => validateVideoScriptPlan({
    ...plan,
    wordCount: 1,
    body: "too short",
    scenes: plan.scenes.map((scene, index) => index === 0 ? { ...scene, overlay: "one two three four five six seven eight" } : scene),
  }, project), VideoValidationError);
});

function inputPayload() {
  return {
    recipeId: "seller_education",
    audience: "Local homeowners",
    objective: "Generate seller leads",
    brief: { serviceArea: "Scarborough", offer: "a practical seller checklist" },
    durationSeconds: 15,
    assets: [{ id: "logo-1", kind: "logo", url: "https://example.com/logo.png" }],
  };
}
