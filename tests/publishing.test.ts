import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePublishReadiness } from "../src/lib/campaigns/publishing.ts";

test("evaluatePublishReadiness blocks publishing without approved human review", () => {
  const result = evaluatePublishReadiness({
    providerConnectionStatus: "connected",
    approvalStatus: "requested",
    complianceStatus: "approved",
    hasDraftPayload: true,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["Human approval is required before publishing."]);
});

test("evaluatePublishReadiness blocks disconnected providers and compliance failures", () => {
  const result = evaluatePublishReadiness({
    providerConnectionStatus: "needs_attention",
    approvalStatus: "approved",
    complianceStatus: "blocked",
    hasDraftPayload: true,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, [
    "Provider connection is not healthy.",
    "Compliance review has unresolved high-risk findings.",
  ]);
});

test("evaluatePublishReadiness allows approved, compliant, connected drafts", () => {
  const result = evaluatePublishReadiness({
    providerConnectionStatus: "connected",
    approvalStatus: "approved",
    complianceStatus: "approved",
    hasDraftPayload: true,
  });

  assert.deepEqual(result, { ready: true, blockers: [] });
});
