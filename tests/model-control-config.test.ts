import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelControlViewData,
  getCuratedModelOptionsForProfile,
  validateModelProfileSelection,
} from "../src/lib/ai/model-control-config.ts";

test("validateModelProfileSelection rejects unknown profile keys", () => {
  const result = validateModelProfileSelection("unknown_profile", {
    provider: "google",
    model: "gemini-2.0-flash-001",
  });

  assert.deepEqual(result, {
    ok: false,
    status: 404,
    error: "Unknown model profile: unknown_profile",
  });
});

test("curated catalog populates every profile with real model options", () => {
  for (const key of ["cheap_draft_text", "structured_json", "vision_classification", "image_draft"] as const) {
    const options = getCuratedModelOptionsForProfile(key);
    assert.ok(options.length > 0, `${key} should expose catalog models`);
    assert.ok(options.every((option) => option.inputUsdPerMillionTokens >= 0));
  }
});

test("catalog filters out image generators for text profiles", () => {
  const options = getCuratedModelOptionsForProfile("cheap_draft_text");
  assert.ok(options.every((option) => !option.supportsImageOutput));
});

test("image profiles only surface image-capable models", () => {
  const options = getCuratedModelOptionsForProfile("image_draft");
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.supportsImageOutput));
});

test("a catalog model is accepted with its real pricing preserved", () => {
  const result = validateModelProfileSelection("cheap_draft_text", {
    provider: "deepseek",
    model: "deepseek-chat",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.option.provider, "deepseek");
    assert.equal(result.option.model, "deepseek-chat");
  }
});

test("a custom free-text model is accepted for a compatible text profile", () => {
  const result = validateModelProfileSelection("cheap_draft_text", {
    provider: "openai",
    model: "gpt-4o-mini",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.option.model, "gpt-4o-mini");
    assert.match(result.option.label, /custom/);
  }
});

test("a custom model is rejected when the provider cannot meet the profile capability", () => {
  // deepseek has no vision input, so it cannot back the vision profile.
  const vision = validateModelProfileSelection("vision_classification", {
    provider: "deepseek",
    model: "deepseek-chat",
  });
  assert.equal(vision.ok, false);
  assert.equal(vision.status, 400);

  // only openai/google generate images, so deepseek cannot back image profiles.
  const image = validateModelProfileSelection("image_draft", {
    provider: "deepseek",
    model: "deepseek-chat",
  });
  assert.equal(image.ok, false);
  assert.equal(image.status, 400);
});

test("buildModelControlViewData keeps every app-area section visible", () => {
  const data = buildModelControlViewData();

  assert.deepEqual(
    data.sections.map((section) => section.label),
    ["Research", "Campaigns", "Creative", "Compliance", "Agent Workforce", "Reporting"],
  );
  assert.ok(data.sections.every((section) => section.profiles.length > 0));

  const creative = data.sections.find((section) => section.label === "Creative");
  assert.deepEqual(creative?.profiles.map((profile) => profile.key), ["image_draft", "image_final"]);
});

test("buildModelControlViewData gives each profile a non-empty option list", () => {
  const data = buildModelControlViewData();
  const profiles = data.sections.flatMap((section) => section.profiles);
  assert.ok(profiles.every((profile) => profile.options.length > 0));
});
