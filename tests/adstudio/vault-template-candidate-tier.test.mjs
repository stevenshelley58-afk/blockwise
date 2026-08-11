import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolvePricedGoogleImageFinalCandidate } from "../../scripts/adstudio/vault-template-execution.mjs";

test("vault renderer resolves the exact priced Google tier requested", () => {
  const profile = {
    primary: { provider: "google", model: "gemini-3.1-flash-image", imageUsdPerUnit: 0.067 },
    fallbacks: [
      { provider: "google", model: "gemini-3-pro-image", imageUsdPerUnit: 0.134 },
      { provider: "openai", model: "gpt-image-2", imageUsdPerUnit: 0.211 },
    ],
  };

  assert.deepEqual(resolvePricedGoogleImageFinalCandidate(profile), {
    candidateIndex: 0,
    candidate: profile.primary,
  });
  assert.deepEqual(resolvePricedGoogleImageFinalCandidate(profile, 1), {
    candidateIndex: 1,
    candidate: profile.fallbacks[0],
  });
});

test("vault renderer rejects invalid, out-of-range, and non-Google candidate tiers", () => {
  const profile = {
    primary: { provider: "google", model: "gemini-3.1-flash-image", imageUsdPerUnit: 0.067 },
    fallbacks: [
      { provider: "google", model: "gemini-3-pro-image", imageUsdPerUnit: 0.134 },
      { provider: "openai", model: "gpt-image-2", imageUsdPerUnit: 0.211 },
    ],
  };

  assert.throws(() => resolvePricedGoogleImageFinalCandidate(profile, -1), /non-negative integer/);
  assert.throws(() => resolvePricedGoogleImageFinalCandidate(profile, 3), /outside the priced image_final candidate list/);
  assert.throws(() => resolvePricedGoogleImageFinalCandidate(profile, 2), /only supports Google candidates/);
});

test("vault renderer records the selected immutable candidate in secret-free evidence", () => {
  const command = readFileSync("scripts/adstudio/customer-template-fixture.mjs", "utf8");
  assert.match(command, /resolvePricedImageFinalCandidate\(resolveModelProfile\("image_final"\), options\.candidateIndex \?\? candidateIndexArg\(\)\)/);
  assert.match(command, /requestHash: verified\.requestHash/);
  assert.match(command, /candidateIndex: selected\.candidateIndex/);
  assert.match(command, /selectedCandidate: \{/);
  assert.match(command, /candidateIndexArg\(\)/);
});
