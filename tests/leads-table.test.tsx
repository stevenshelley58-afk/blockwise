import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LeadsTable,
  type LeadListItem,
} from "../src/components/leads/leads-table.tsx";

const fixtureRows: LeadListItem[] = [
  {
    id: "lead-fixture-1",
    name: "Avery Example",
    email: "avery@example.test",
    phone: "+61 400 111 222",
    suburb: "Perth",
    source: "Meta lead form",
    attribution: "Vendor appraisal",
    quality: "unlabelled",
    createdAt: "2026-09-06T09:00:00.000Z",
    duplicateCandidate: false,
    delivery: "Failed",
  },
  {
    id: "lead-fixture-2",
    name: "Jordan Example",
    email: "",
    phone: "0412 999 888",
    suburb: "Fremantle",
    source: "Meta lead form",
    attribution: "Sold-price list",
    quality: "high_intent",
    createdAt: "2026-09-06T10:00:00.000Z",
    duplicateCandidate: true,
    delivery: "Manual review",
  },
  {
    id: "lead-fixture-3",
    name: "Unsafe Example",
    email: "unsafe@example.test?bcc=outside@example.test",
    phone: "not-a-phone",
    suburb: "Perth",
    source: "Meta lead form",
    attribution: "",
    quality: "unlabelled",
    createdAt: "2026-09-06T11:00:00.000Z",
    duplicateCandidate: false,
    delivery: "Queued",
  },
  {
    id: "lead-fixture-4",
    name: "Punctuation Example",
    email: "",
    phone: "(08) 9123-4567",
    suburb: "Perth",
    source: "Meta lead form",
    attribution: "",
    quality: "unlabelled",
    createdAt: "2026-09-06T12:00:00.000Z",
    duplicateCandidate: false,
    delivery: "Queued",
  },
  {
    id: "lead-fixture-5",
    name: "Empty Example",
    email: "",
    phone: "",
    suburb: "Perth",
    source: "Meta lead form",
    attribution: "",
    quality: "unlabelled",
    createdAt: "2026-09-06T13:00:00.000Z",
    duplicateCandidate: false,
    delivery: "Queued",
  },
];

test("LeadsTable renders safe contact actions and delivery recovery in desktop and mobile markup", () => {
  const html = renderToStaticMarkup(
    createElement(LeadsTable, {
      rows: fixtureRows,
      workspaceId: "workspace-test",
      canEditQuality: false,
    }),
  );
  assert.match(html, /href="tel:\+61400111222"/);
  assert.match(html, /aria-label="Call Avery Example"/);
  assert.match(html, /href="mailto:avery%40example.test"/);
  assert.match(html, /aria-label="Email Avery Example"/);
  assert.equal((html.match(/Call Avery Example/g) ?? []).length, 2);
  assert.match(
    html,
    /Delivery failed\. Ask a workspace owner or Blockwise support to review the saved delivery attempt\./,
  );
  assert.match(html, /This lead is waiting for your team to follow up\./);
  assert.doesNotMatch(html, /Call Unsafe Example/);
  assert.match(html, /href="tel:0412999888"/);
  assert.match(html, /href="tel:0891234567"/);
  assert.doesNotMatch(html, /Call Empty Example/);
  assert.doesNotMatch(html, /Email Empty Example/);
  assert.doesNotMatch(html, /Email Unsafe Example/);
  assert.equal(fixtureRows[0].quality, "unlabelled");
});
