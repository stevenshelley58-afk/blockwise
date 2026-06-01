import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentRunRows,
  buildAiLedgerRows,
  buildApprovalRows,
  buildCampaignReadinessRows,
  buildLeadRowsWithDedupe,
  buildResearchSignals,
} from "../src/modules/product/live-data.ts";

test("buildCampaignReadinessRows uses Supabase rows, approvals, compliance reports, and provider health", () => {
  const rows = buildCampaignReadinessRows({
    campaigns: [
      {
        id: "campaign_1",
        name: "Seller campaign",
        provider: "meta",
        status: "draft",
        draft_payload: { headline: "Seller checklist" },
      },
    ],
    approvals: [{ target_id: "campaign_1", status: "approved" }],
    complianceReports: [{ campaign_id: "campaign_1", status: "approved" }],
    providerConnections: [{ provider: "meta", status: "connected" }],
  });

  assert.equal(rows[0].provider, "Meta");
  assert.equal(rows[0].approvalStatus, "approved");
  assert.equal(rows[0].complianceStatus, "approved");
  assert.deepEqual(rows[0].readiness, { ready: true, blockers: [] });
});

test("buildLeadRowsWithDedupe maps live leads, labels, attribution, and duplicate state", () => {
  const result = buildLeadRowsWithDedupe({
    leads: [
      {
        id: "lead_1",
        full_name: "Amelia Hart",
        email: "amelia@example.com",
        phone: "0400 111 222",
        suburb: "Subiaco",
        provider: "meta",
        created_at: "2026-05-27T01:00:00.000Z",
      },
      {
        id: "lead_2",
        full_name: "Daniel Ng",
        email: "daniel@example.com",
        phone: "0400 333 444",
        suburb: "Leederville",
        provider: "google",
        created_at: "2026-05-27T02:00:00.000Z",
      },
    ],
    labels: [{ lead_id: "lead_1", label: "High intent" }],
    attributions: [{ lead_id: "lead_1", source: { campaignName: "Seller checklist" } }],
    dedupeRecords: [{ lead_id: "lead_1", duplicate_of_lead_id: "lead_2" }],
  });

  assert.equal(result.rows[0].source, "Meta lead form");
  assert.equal(result.rows[0].quality, "High intent");
  assert.equal(result.rows[0].duplicateCandidate, true);
  assert.equal(result.rows[0].attribution, "Seller checklist");
  assert.equal(result.incoming.duplicateIds.length, 0);
});

test("buildApprovalRows and buildAgentRunRows keep queues workspace backed", () => {
  assert.deepEqual(
    buildApprovalRows([
      {
        id: "approval_1",
        target_type: "campaign",
        status: "requested",
        risk_summary: "Housing targeting review",
        workspaces: { name: "Northstar" },
      },
    ]),
    [
      {
        id: "approval_1",
        title: "campaign approval",
        workspace: "Northstar",
        risk: "Housing targeting review",
        status: "requested",
      },
    ],
  );

  assert.deepEqual(
    buildAgentRunRows([
      {
        id: "agent_run_1",
        status: "completed",
        task: "Classify competitor hooks",
        confidence: 0.91,
        error_message: null,
        workspaces: { name: "Northstar" },
        agent_definitions: { name: "Research Agent" },
      },
    ]),
    [
      {
        id: "agent_run_1",
        agent: "Research Agent",
        task: "Classify competitor hooks",
        status: "Complete",
        workspace: "Northstar",
        cost: "$0.00",
        confidence: "91%",
      },
    ],
  );
});

test("buildAiLedgerRows and buildResearchSignals map production tables", () => {
  assert.deepEqual(
    buildAiLedgerRows([
      {
        id: "run_1",
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        task: "campaign_copy",
        output_type: "json",
        result: "completed",
        estimated_cost_cents: 2,
        workspaces: { name: "Northstar" },
      },
    ]),
    [
      {
        id: "run_1",
        workspace: "Northstar",
        profile: "openrouter",
        task: "campaign_copy",
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        usage: "json",
        estimatedCost: "$0.02",
        result: "completed",
      },
    ],
  );

  assert.deepEqual(
    buildResearchSignals([
      {
        competitor: "Perth Appraisal Co.",
        signal: "Seller guide ads",
        evidence: "Public ad library capture",
        confidence: 0.91,
      },
    ]),
    [
      {
        competitor: "Perth Appraisal Co.",
        signal: "Seller guide ads",
        evidence: "Public ad library capture",
        confidence: "91%",
      },
    ],
  );
});
