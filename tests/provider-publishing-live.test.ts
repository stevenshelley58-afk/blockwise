import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdStudioPublishRequests,
  resolveAdStudioPublishReadiness,
} from "../src/lib/providers/publishing-adapters.ts";

test("resolveAdStudioPublishReadiness uses real approval and provider status", () => {
  assert.deepEqual(
    resolveAdStudioPublishReadiness({
      approvalStatus: "requested",
      complianceStatus: "approved",
      providerStatuses: { meta: "connected" },
      hasDraftPayload: true,
    }),
    {
      ready: false,
      blockers: ["Human approval is required before publishing."],
    },
  );

  assert.deepEqual(
    resolveAdStudioPublishReadiness({
      approvalStatus: "approved",
      complianceStatus: "approved",
      providerStatuses: { meta: "connected" },
      hasDraftPayload: true,
    }),
    { ready: true, blockers: [] },
  );
});

test("buildAdStudioPublishRequests prepares the server-owned Meta payload", () => {
  const requests = buildAdStudioPublishRequests({
    exportPackageId: "export_1",
    workspaceId: "workspace_1",
    metaAccountId: "act_123",
    metaPayload: { primaryText: ["Seller checklist"], headlines: ["Checklist"] },
  });

  assert.deepEqual(requests.map((request) => request.provider), ["meta"]);
  assert.equal(requests[0].endpoint, "/act_123/campaigns");
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(requests[0].body.special_ad_categories, ["HOUSING"]);
  // No ad account means nothing is published, not an empty Meta request.
  assert.deepEqual(buildAdStudioPublishRequests({
    exportPackageId: "export_1",
    workspaceId: "workspace_1",
    metaAccountId: null,
    metaPayload: { primaryText: ["Seller checklist"] },
  }), []);
});
