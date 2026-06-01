import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRealEstateCompliance } from "../src/modules/compliance/real-estate-policy.ts";

test("evaluateRealEstateCompliance flags unsupported performance and urgency claims", () => {
  const result = evaluateRealEstateCompliance({
    region: "AU",
    copy: "Guaranteed top price if you sell this weekend. Perth's #1 agency gets instant results.",
    channel: "meta",
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["unsupported_guarantee", "unsupported_rank_claim", "misleading_urgency"],
  );
});

test("evaluateRealEstateCompliance allows practical suburb appraisal copy", () => {
  const result = evaluateRealEstateCompliance({
    region: "AU",
    copy: "See recent buyer demand and comparable sales activity in your suburb before planning your next move.",
    channel: "google",
  });

  assert.equal(result.status, "approved");
  assert.equal(result.findings.length, 0);
});
