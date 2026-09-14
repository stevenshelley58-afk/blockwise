import assert from "node:assert/strict";
import test from "node:test";

import { formatLeadCrmDelivery } from "../src/lib/crm/delivery.ts";
import { buildLeadRowsWithDedupe } from "../src/lib/operator/overview.ts";

// --- the label the customer reads ------------------------------------------

test("a lead with no registered CRM handoff says nothing", () => {
  assert.equal(formatLeadCrmDelivery(undefined), null);
});

test("a delivered lead names the CRM record the customer can quote", () => {
  assert.equal(
    formatLeadCrmDelivery({ lead_id: "l1", state: "delivered", crm_lead: "CRM-LEAD-2026-00016" }),
    "In CRM as CRM-LEAD-2026-00016",
  );
});

test("a delivered lead with no CRM name still reports the delivery", () => {
  assert.equal(formatLeadCrmDelivery({ lead_id: "l1", state: "delivered", crm_lead: null }), "In CRM");
});

test("a failed handoff is reported as failed, not as still waiting", () => {
  assert.equal(formatLeadCrmDelivery({ lead_id: "l1", state: "error", crm_lead: null }), "CRM delivery failed");
});

test("a registered but unfinished handoff reads as waiting", () => {
  assert.equal(formatLeadCrmDelivery({ lead_id: "l1", state: "pending", crm_lead: null }), "Waiting for CRM");
});

// --- the mapping onto the customer's lead list ------------------------------

function lead(id: string) {
  return { id, created_at: "2026-09-06T09:00:00.000Z" };
}

test("the lead list carries each lead's own CRM state", () => {
  const { rows } = buildLeadRowsWithDedupe({
    leads: [lead("l1"), lead("l2"), lead("l3")],
    crmDeliveries: [
      { lead_id: "l1", state: "delivered", crm_lead: "CRM-LEAD-2026-00016" },
      { lead_id: "l3", state: "error", crm_lead: null },
    ],
  });

  assert.equal(rows[0].crmDelivery, "In CRM as CRM-LEAD-2026-00016");
  assert.equal(rows[1].crmDelivery, null);
  assert.equal(rows[2].crmDelivery, "CRM delivery failed");
});

test("an unrecognised delivery state is not trusted as delivered", () => {
  const { rows } = buildLeadRowsWithDedupe({
    leads: [lead("l1")],
    crmDeliveries: [{ lead_id: "l1", state: "something-new", crm_lead: "CRM-LEAD-2026-00099" }],
  });

  assert.equal(rows[0].crmDelivery, "Waiting for CRM");
});

test("a delivery row for another lead, or with no lead id, is ignored", () => {
  const { rows } = buildLeadRowsWithDedupe({
    leads: [lead("l1")],
    crmDeliveries: [
      { lead_id: "some-other-lead", state: "delivered", crm_lead: "CRM-LEAD-2026-00001" },
      { lead_id: null, state: "delivered", crm_lead: "CRM-LEAD-2026-00002" },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].crmDelivery, null);
});

test("omitting the CRM rows keeps every lead silent", () => {
  const { rows } = buildLeadRowsWithDedupe({ leads: [lead("l1")] });

  assert.equal(rows[0].crmDelivery, null);
});

test("the CRM state does not disturb the delivery attempt column", () => {
  const { rows } = buildLeadRowsWithDedupe({
    leads: [lead("l1")],
    deliveryAttempts: [
      { lead_id: "l1", status: "delivered", destination_label: "Webhook", created_at: "2026-09-06T09:05:00.000Z" },
    ],
    crmDeliveries: [{ lead_id: "l1", state: "pending", crm_lead: null }],
  });

  assert.equal(rows[0].delivery, "Delivered to Webhook");
  assert.equal(rows[0].crmDelivery, "Waiting for CRM");
});
