import assert from "node:assert/strict";
import test from "node:test";

import { createAiRunLedgerEntry } from "../src/lib/model-control/run-ledger.ts";

test("createAiRunLedgerEntry records completed usage with profile cost estimate", () => {
  const entry = createAiRunLedgerEntry({
    workspaceId: "workspace_demo",
    userId: "user_demo",
    profileKey: "cheap_draft_text",
    task: "campaign_hook_draft",
    outputType: "text",
    usage: { inputTokens: 10_000, outputTokens: 1_000 },
  });

  assert.equal(entry.status, "completed");
  assert.equal(entry.provider, "openai");
  assert.equal(entry.model, "gpt-4.1-mini");
  assert.equal(entry.estimatedCostUsd, 0.01);
  assert.equal(entry.blockReason, undefined);
});

test("createAiRunLedgerEntry blocks runs over profile cost policy", () => {
  const entry = createAiRunLedgerEntry({
    workspaceId: "workspace_demo",
    userId: "user_demo",
    profileKey: "image_final",
    task: "final_image_generation",
    outputType: "image",
    usage: { inputTokens: 0, outputTokens: 0, imageUnits: 30 },
  });

  assert.equal(entry.status, "blocked");
  assert.equal(entry.estimatedCostUsd, 2.36);
  assert.equal(entry.blockReason, "Estimated run cost $2.36 exceeds image_final max run cost $2.00.");
});
