import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelControlViewData,
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

test("validateModelProfileSelection rejects uncurated model ids", () => {
  const result = validateModelProfileSelection("cheap_draft_text", {
    provider: "google",
    model: "not-approved/model",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /not approved for Cheap draft text/);
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
