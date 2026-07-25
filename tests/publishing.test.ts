import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePublishReadiness } from "../src/lib/publishing/readiness.ts";

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

test("evaluatePublishReadiness does not block the default needs_review compliance status", () => {
  // The human compliance review step was removed from the product (Meta runs
  // its own ad review) and every pack defaults to "needs_review" — blocking
  // on it froze all publishes behind a checklist item the UI no longer shows.
  const result = evaluatePublishReadiness({
    providerConnectionStatus: "connected",
    approvalStatus: "approved",
    complianceStatus: "needs_review",
    hasDraftPayload: true,
  });

  assert.deepEqual(result, { ready: true, blockers: [] });
});
