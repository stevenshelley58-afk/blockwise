import assert from "node:assert/strict";
import test from "node:test";
import { generateDeterministicVideoScript, normalizeRenderedScenePlan } from "../../src/lib/adstudio/video/script.ts";
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

test("free-form creative brief is persisted and shapes deterministic copy", () => {
  const project = parseVideoProjectInput({
    ...inputPayload(),
    brief: { serviceArea: "Scarborough", offer: "a practical seller checklist", creativeBrief: "Show how local school timing affects a move." },
  });
  assert.equal(project.brief.creativeBrief, "Show how local school timing affects a move.");
  assert.match(generateDeterministicVideoScript(project).body, /Show how local school/u);
});

test("deterministic scene plan carries selected media into distinct beats", () => {
  const project = parseVideoProjectInput({
    ...inputPayload(),
    assets: [
      { id: "logo-1", kind: "logo", url: "https://example.com/logo.png" },
      { id: "photo-1", kind: "photo", url: "https://example.com/photo.jpg" },
      { id: "video-1", kind: "video", url: "https://example.com/video.mp4" },
      { id: "proof-1", kind: "proof", url: "https://example.com/proof.png" },
    ],
  });
  const plan = generateDeterministicVideoScript(project);
  assert.deepEqual(plan.scenes.map((scene) => scene.assetIds), [["photo-1"], ["video-1"], ["proof-1"], ["logo-1"]]);
  assert.equal(plan.scenes[0]?.narration, plan.hookVariants[0]?.text);
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
  assert.doesNotThrow(() => parseVideoProjectInput({
    ...inputPayload(),
    brief: { serviceArea: "Scarborough", offer: "Request a property valuation" },
  }));
  assert.throws(() => parseVideoProjectInput({
    ...inputPayload(),
    brief: { serviceArea: "Scarborough", offer: "Request a property valuation of $1.2m" },
  }), VideoValidationError);
});

test("draft validation can persist incomplete workspace work, while readiness remains strict", () => {
  const incomplete = { ...inputPayload(), assets: [] };
  assert.doesNotThrow(() => parseVideoProjectInput(incomplete, { requireReadiness: false }));
  assert.throws(() => parseVideoProjectInput(incomplete, { requireReadiness: true }), VideoValidationError);
});

test("workspace media proxy assets are accepted only for the active workspace", () => {
  const payload = { ...inputPayload(), assets: [{ id: "logo-1", kind: "logo", url: "/api/adstudio/media?path=workspace-1%2Fbrand%2Flogo.png" }] };
  assert.doesNotThrow(() => parseVideoProjectInput(payload, { workspaceId: "workspace-1" }));
  assert.throws(() => parseVideoProjectInput(payload, { workspaceId: "workspace-2" }), VideoValidationError);
});

test("photo and video-only projects assign the third media beat without duplicating assets", () => {
  const project = parseVideoProjectInput({
    ...inputPayload(),
    assets: [
      { id: "logo-1", kind: "logo", url: "https://example.com/logo.png" },
      { id: "photo-1", kind: "photo", url: "https://example.com/photo.jpg" },
      { id: "video-1", kind: "video", url: "https://example.com/video.mp4" },
      { id: "video-2", kind: "video", url: "https://example.com/video-2.mp4" },
    ],
  });
  const plan = generateDeterministicVideoScript(project);
  assert.equal(plan.scenes[2]?.assetIds[0], "video-2");
  assert.equal(new Set(plan.scenes.flatMap((scene) => scene.assetIds)).size, 4);
});

test("provider scene normalization drops hallucinated asset IDs", () => {
  const project = input();
  const plan = generateDeterministicVideoScript(project);
  const normalized = normalizeRenderedScenePlan({
    ...plan,
    selectedHookId: "hook_b",
    scenes: plan.scenes.map((scene, index) => index === 0 ? { ...scene, assetIds: ["provider-hallucination"] } : scene),
  }, project);
  assert.deepEqual(normalized.scenes[0]?.assetIds, []);
  assert.equal(normalized.scenes[0]?.narration, normalized.hookVariants[1]?.text);
});

test("testimonial assets require matching approved, unexpired consent", () => {
  const payload = {
    ...inputPayload(),
    recipeId: "testimonial_case_study",
    assets: [
      { id: "logo-1", kind: "logo", url: "https://example.com/logo.png" },
      { id: "testimonial-1", kind: "testimonial", url: "https://example.com/testimonial.mp4", consentId: "consent-1" },
    ],
    consentRecords: [{ id: "consent-1", assetId: "testimonial-1", subject: "A client", scope: "lead generation video", capturedAt: "2026-01-01T00:00:00.000Z", status: "pending" }],
  };
  assert.throws(() => parseVideoProjectInput(payload), VideoValidationError);
  assert.doesNotThrow(() => parseVideoProjectInput({ ...payload, consentRecords: [{ ...payload.consentRecords[0], status: "approved" }] }));
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
