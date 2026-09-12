import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDashboard, type HomeData } from "../src/components/self-serve/home-dashboard.tsx";
import { SAMPLE_CRM_LEADS, sampleHomeLeads } from "../src/lib/leads/sample-crm-leads.ts";

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    workspaceName: "West Coast Home Co",
    hasBrand: true,
    hasProvider: false,
    ads: { created: 0, live: null, publishedThisWeek: 0 },
    performance: null,
    leads: [],
    leadsAreExamples: false,
    localAds: [],
    localAdsArea: null,
    activation: {
      currentStage: "brand",
      nextAction: "brand",
      resumePath: "/ad-studio/brand",
      completed: 1,
      total: 3,
      milestones: {},
      foundationAvailable: true,
    },
    credits: {
      granted: 10,
      used: 0,
      reserved: 0,
      remaining: 10,
      entitlementType: "trial",
      periodStart: null,
      periodEnd: null,
    },
    plan: {
      accessState: "trialing",
      currency: "AUD",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      latestInvoiceStatus: null,
    },
    meta: { state: "not_connected", accountName: null },
    booking: { state: "not_booked" },
    ...overrides,
  } as HomeData;
}

test("the example leads use Frappe CRM's own status and source records", () => {
  // crm/install.py seeds these two lists, and `CRM Lead Source` / `CRM Lead
  // Status` are Link fields, so a demo that used invented values would not map
  // onto a real deployment.
  const statuses = new Set([
    "New",
    "Contacted",
    "Nurture",
    "Qualified",
    "Converted",
    "Unqualified",
    "Junk",
  ]);
  const sources = new Set([
    "Email",
    "Existing Customer",
    "Reference",
    "Advertisement",
    "Cold Calling",
    "Exhibition",
    "Supplier Reference",
    "Mass Mailing",
    "Customer's Vendor",
    "Campaign",
    "Walk In",
    "Facebook",
    "Website",
    "Web Form",
  ]);

  assert.ok(SAMPLE_CRM_LEADS.length > 0);
  for (const lead of SAMPLE_CRM_LEADS) {
    assert.ok(statuses.has(lead.status), `${lead.status} is not a Frappe CRM lead status`);
    assert.ok(sources.has(lead.source), `${lead.source} is not a Frappe CRM lead source`);
    assert.equal(lead.lead_name, `${lead.first_name} ${lead.last_name}`);
    assert.ok(lead.territory);
    assert.ok(lead.lead_owner);
    assert.ok(lead.createdAgoMs > 0);
  }
});

test("example leads carry a CRM status, so no row claims to be unread", () => {
  const rows = sampleHomeLeads(new Date("2026-09-12T08:00:00.000Z").getTime());

  assert.equal(rows.length, SAMPLE_CRM_LEADS.length);
  for (const row of rows) {
    assert.ok(row.name && row.suburb && row.source && row.status);
    assert.ok(Number.isFinite(Date.parse(row.createdAt)));
  }
  // Newest first, because the list is read as "what came in".
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Priya Raman", "Daniel Okafor", "Hannah Whitfield", "Marcus Bell"],
  );
});

test("a demo workspace sees example leads, said as examples, with the one next action", () => {
  const html = renderToStaticMarkup(
    createElement(HomeDashboard, {
      data: homeData({ leads: sampleHomeLeads(), leadsAreExamples: true }),
    }),
  );

  assert.match(html, /Example leads/);
  assert.match(html, /Priya Raman/);
  assert.match(html, /Scarborough · Facebook/);
  // The CRM's status record is what the row reports, not a made-up waiting time.
  assert.match(html, />New</);
  // The bar closes the section and carries the same call to action the demo
  // figures bar carries, so both say and offer the same thing.
  assert.match(html, /Create an ad/);
  const lastRow = html.lastIndexOf("Marcus Bell");
  const note = html.indexOf("Example leads");
  const cta = html.indexOf("Create an ad");
  assert.ok(note > lastRow, "the example note sits under the rows");
  assert.ok(cta > note, "the action sits in the note bar");

  // Nothing pretends the workspace has leads of its own: no count of leads to
  // follow up, and no way into a Leads page that would be empty.
  assert.doesNotMatch(html, /not yet followed up/);
  assert.doesNotMatch(html, /href="\/leads"/);
  assert.doesNotMatch(html, /Waiting \d+ day/);
});

test("a workspace with its own leads keeps the real list and no example note", () => {
  const html = renderToStaticMarkup(
    createElement(HomeDashboard, {
      data: homeData({
        leadsAreExamples: false,
        leads: [
          {
            id: "lead-1",
            name: "Ana Whitfield",
            suburb: "Scarborough",
            source: "Meta lead form",
            createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        ],
      }),
    }),
  );

  assert.doesNotMatch(html, /Example leads/);
  assert.match(html, /1 not yet followed up/);
  assert.match(html, /Waiting 3 days/);
  assert.match(html, /href="\/leads"/);
  assert.doesNotMatch(html, /Create an ad/);
});

test("a lead the CRM has a status for reports the status, not waiting time", () => {
  const html = renderToStaticMarkup(
    createElement(HomeDashboard, {
      data: homeData({
        leads: [
          {
            id: "lead-2",
            name: "Marcus Bell",
            suburb: "Applecross",
            source: "Reference",
            status: "Qualified",
            createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
          },
        ],
      }),
    }),
  );

  assert.match(html, /Qualified/);
  assert.doesNotMatch(html, /Waiting 9 days/);
});
