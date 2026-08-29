import assert from "node:assert/strict";
import test from "node:test";

import {
  appendGeneration,
  createGenerationTrace,
  LIKENESS_THRESHOLD,
  validateGenerationTrace,
} from "../../scripts/adstudio/v2/generation-trace.mjs";

const hash = (character) => character.repeat(64);

function record(trace, primaryScore, strictScore, revisionReason = "Increase title scale and restore the source hierarchy") {
  return appendGeneration(trace, {
    feedSha256: hash("b"),
    storySha256: hash("c"),
    renderSetSha256: hash("d"),
    primaryReviewer: "vision-primary-v1",
    strictReviewer: "vision-strict-v1",
    primaryScore,
    strictScore,
    revisionReason,
  });
}

test("generation trace preserves a seed as non-authoritative provenance", () => {
  const trace = createGenerationTrace({ templateId: "meta-feed-180", sourceSha256: hash("a"), seedSha256: hash("e") });
  assert.equal(validateGenerationTrace(trace), trace);
  assert.equal(trace.status, "active");
  assert.equal(trace.generations.length, 0);
});

test("scores below 9.5 require another generation and retain the revision reason", () => {
  const trace = record(createGenerationTrace({ templateId: "meta-feed-180", sourceSha256: hash("a") }), 9.7, 9.4);
  assert.equal(trace.status, "active");
  assert.equal(trace.generations[0].decision, "revise");
  assert.match(trace.generations[0].revisionReason, /title scale/);
});

test("both independent scores at 9.5 or higher close the trace", () => {
  const trace = record(createGenerationTrace({ templateId: "meta-feed-180", sourceSha256: hash("a") }), LIKENESS_THRESHOLD, 9.8, "Both independent reviewers accepted the final render");
  assert.equal(trace.status, "accepted");
  assert.equal(trace.generations[0].decision, "accepted");
  assert.throws(() => record(trace, 10, 10), /closed generation trace/);
});

test("the same reviewer cannot supply both supposedly independent scores", () => {
  const trace = createGenerationTrace({ templateId: "meta-feed-180", sourceSha256: hash("a") });
  assert.throws(() => appendGeneration(trace, {
    feedSha256: hash("b"), storySha256: hash("c"), renderSetSha256: hash("d"),
    primaryReviewer: "same-reviewer", strictReviewer: "same-reviewer",
    primaryScore: 9.8, strictScore: 9.8, revisionReason: "Reviewers must remain independently attributable",
  }), /independent identities/);
});
