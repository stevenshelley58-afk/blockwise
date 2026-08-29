import test from "node:test";
import assert from "node:assert/strict";

import { diversityFailures } from "../../scripts/verify/adstudio-diversity.mjs";

function doc(id, intent = "lead_gen") {
  return {
    id,
    classification: { primary_intent: intent },
    formats: {
      feed: { layers: [{ type: "shape", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }] },
      story: { layers: [{ type: "shape", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }] },
    },
  };
}

test("a one-template gallery is below the intent-concentration scope", () => {
  assert.deepEqual(diversityFailures([doc("one")]), []);
});

test("a five-template monoculture fails intent diversity and concentration", () => {
  const failures = diversityFailures(Array.from({ length: 5 }, (_, index) => doc(`same-${index}`)));
  assert.match(failures.join("\n"), /only 1 distinct non-other intents/);
  assert.match(failures.join("\n"), /intent "lead_gen" is 100%/);
  assert.match(failures.join("\n"), /identical layout skeleton/);
});
