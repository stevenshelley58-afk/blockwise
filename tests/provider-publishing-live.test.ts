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
      providerStatuses: { meta: "connected", google: "connected" },
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
      providerStatuses: { meta: "connected", google: "connected" },
      hasDraftPayload: true,
    }),
    { ready: true, blockers: [] },
  );
});

test("buildAdStudioPublishRequests prepares server-owned Meta and Google payloads", () => {
  const requests = buildAdStudioPublishRequests({
    exportPackageId: "export_1",
    workspaceId: "workspace_1",
    metaAccountId: "act_123",
    googleCustomerId: "customers/456",
    metaPayload: { primaryText: ["Seller checklist"], headlines: ["Checklist"] },
    googlePayload: { headlines: ["Seller Checklist"], keywords: ["sell house subiaco"] },
  });

  assert.deepEqual(requests.map((request) => request.provider), ["meta", "google"]);
  assert.equal(requests[0].endpoint, "/act_123/campaigns");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[1].endpoint, "/customers/456/googleAds:mutate");
  assert.equal(requests[1].body.validateOnly, false);
});
