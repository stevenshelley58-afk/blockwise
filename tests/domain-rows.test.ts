import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildLeadRowsWithDedupe } from "../src/lib/leads/rows.ts";
import { buildApprovalRows } from "../src/lib/publishing/approvals.ts";
import { buildAgentRunRows, buildAiLedgerRows } from "../src/lib/operator/overview.ts";

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
        ai_runs: { estimated_cost_cents: 37 },
      },
    ]),
    [
      {
        id: "agent_run_1",
        agent: "Research Agent",
        task: "Classify competitor hooks",
        status: "Complete",
        workspace: "Northstar",
        cost: "$0.37",
        confidence: "91%",
      },
    ],
  );
});

test("buildAiLedgerRows maps production ledger rows", () => {
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
        created_at: "2026-06-05T01:02:03.000Z",
        workspaces: { name: "Northstar" },
        user_id: "user_1",
        profiles: { email: "amelia@example.com", full_name: "Amelia Hart" },
      },
    ]),
    [
      {
        id: "run_1",
        workspace: "Northstar",
        userId: "user_1",
        user: "Amelia Hart",
        userEmail: "amelia@example.com",
        profile: "openrouter",
        task: "campaign_copy",
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        usage: "json",
        estimatedCost: "$0.02",
        result: "completed",
        createdAt: "2026-06-05T01:02:03.000Z",
      },
    ],
  );
});

test("AI ledger loaders expose operator filters for user model task and day", () => {
  const overview = readFileSync("src/lib/operator/overview.ts", "utf8");
  const page = readFileSync("src/app/(operator)/model-control/page.tsx", "utf8");

  assert.match(overview, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(overview, /\.eq\("user_id", filters\.userId\)/);
  assert.match(overview, /\.ilike\("model", `%\$\{filters\.model\}%`\)/);
  assert.match(overview, /\.eq\("task", filters\.task\)/);
  assert.match(overview, /\.gte\("created_at", dayRange\.startIso\)\.lt\("created_at", dayRange\.endIso\)/);
  assert.match(page, /name="userId"/);
  assert.match(page, /name="model"/);
  assert.match(page, /name="task"/);
  assert.match(page, /name="day"/);
});
