import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLeadDeliveryActions,
  fetchMetaLeadFormLeads,
  normalizeMetaLead,
} from "../src/lib/providers/meta-leads.ts";

test("normalizeMetaLead maps Meta field_data into Blockwise lead identity", () => {
  const lead = normalizeMetaLead({
    id: "lead_123",
    created_time: "2026-06-02T02:00:00+0000",
    ad_id: "ad_123",
    form_id: "form_123",
    field_data: [
      { name: "full_name", values: ["Alex Seller"] },
      { name: "email", values: ["ALEX@EXAMPLE.COM"] },
      { name: "phone_number", values: ["+61 400 000 000"] },
      { name: "suburb", values: ["Scarborough"] },
    ],
  });

  assert.equal(lead.externalId, "lead_123");
  assert.equal(lead.fullName, "Alex Seller");
  assert.equal(lead.email, "alex@example.com");
  assert.equal(lead.phone, "+61 400 000 000");
  assert.equal(lead.suburb, "Scarborough");
  assert.equal(lead.formId, "form_123");
});

test("fetchMetaLeadFormLeads reads leads for reconciled lead forms", async () => {
  const leads = await fetchMetaLeadFormLeads({
    accessToken: "token",
    formIds: ["form_123"],
    since: "2026-06-01T00:00:00.000Z",
    fetchImpl: async (url) => {
      assert.match(String(url), /form_123\/leads/);
      assert.match(String(url), /filtering=/);

      return new Response(
        JSON.stringify({
          data: [
            {
              id: "lead_123",
              created_time: "2026-06-02T02:00:00+0000",
              form_id: "form_123",
              field_data: [{ name: "email", values: ["alex@example.com"] }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.externalId, "lead_123");
});

test("buildLeadDeliveryActions creates auditable CRM, webhook, email, or manual actions", () => {
  const lead = normalizeMetaLead({
    id: "lead_123",
    field_data: [{ name: "email", values: ["alex@example.com"] }],
  });

  assert.deepEqual(
    buildLeadDeliveryActions(lead, { type: "crm", label: "Agentbox", config: { endpoint: "https://crm.example/leads" } }),
    [{ type: "crm", destination: "Agentbox", endpoint: "https://crm.example/leads", requiresApproval: true }],
  );
  assert.deepEqual(buildLeadDeliveryActions(lead, { type: "manual", label: "Manual review" }), [
    { type: "manual", destination: "Manual review", requiresApproval: false },
  ]);
});
