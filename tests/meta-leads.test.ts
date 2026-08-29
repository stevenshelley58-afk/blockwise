import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLeadDeliveryActions,
  fetchMetaLeadFormLeads,
  type MetaLeadRepository,
  normalizeMetaLead,
  syncMetaLeads,
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
  const requestedUrls: string[] = [];
  const leads = await fetchMetaLeadFormLeads({
    accessToken: "token",
    formIds: ["form_123"],
    since: "2026-06-01T00:00:00.000Z",
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      assert.match(String(url), /form_123\/leads/);
      assert.match(String(url), /filtering=/);

      const filtering = JSON.parse(new URL(String(url)).searchParams.get("filtering") ?? "[]") as Array<{ value: unknown }>;
      assert.equal(filtering[0]?.value, 1780272000);

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
  assert.equal(requestedUrls.length, 1);
});

test("fetchMetaLeadFormLeads follows Meta pagination", async () => {
  let calls = 0;
  const leads = await fetchMetaLeadFormLeads({
    accessToken: "token",
    formIds: ["form_123"],
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          calls === 1
            ? { data: [{ id: "lead_1" }], paging: { next: "https://graph.facebook.com/v23.0/form_123/leads?after=cursor" } }
            : { data: [{ id: "lead_2" }] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(leads.map((lead) => lead.externalId), ["lead_1", "lead_2"]);
  assert.equal(calls, 2);
});

test("buildLeadDeliveryActions creates auditable CRM, webhook, or manual actions", () => {
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

test("syncMetaLeads records delivery attempts only for newly inserted leads", async () => {
  const storedLeads = new Map<string, { leadId: string; email: string | null; phone: string | null }>();
  const deliveryAttempts: unknown[] = [];
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "lead_123",
            created_time: "2026-06-02T02:00:00+0000",
            field_data: [{ name: "email", values: ["alex@example.com"] }],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const repository: MetaLeadRepository = {
    async listExistingLeads() {
      return [...storedLeads.values()].map((lead) => ({
        id: lead.leadId,
        email: lead.email,
        phone: lead.phone,
      }));
    },
    async upsertLead({ lead }) {
      const existing = storedLeads.get(lead.externalId);
      if (existing) {
        return { leadId: existing.leadId, inserted: false };
      }

      const leadId = "lead_row_123";
      storedLeads.set(lead.externalId, { leadId, email: lead.email, phone: lead.phone });
      return { leadId, inserted: true };
    },
    async recordDeliveryAttempt(input: unknown) {
      deliveryAttempts.push(input);
    },
  };

  const syncInput = {
    workspaceId: "workspace_1",
    accessToken: "token",
    formIds: ["form_123"],
    leadDestination: { type: "manual" as const, label: "Manual review" },
    repository,
    fetchImpl,
  };

  const first = await syncMetaLeads(syncInput);
  const second = await syncMetaLeads(syncInput);

  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(deliveryAttempts.length, 1);
});
