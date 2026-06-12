import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAgentRunRows,
  buildAiLedgerRows,
  buildApprovalRows,
  buildLeadRowsWithDedupe,
  normalizeLeadQualityLabel,
  buildResearchSignals,
} from "../src/lib/product/live-data.ts";

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
    labels: [{ lead_id: "lead_1", label: "High intent", created_at: "2026-05-27T03:00:00.000Z" }],
    attributions: [{ lead_id: "lead_1", source: { campaignName: "Seller checklist" } }],
    dedupeRecords: [{ lead_id: "lead_1", duplicate_of_lead_id: "lead_2" }],
    deliveryAttempts: [
      {
        lead_id: "lead_1",
        status: "queued",
        destination_label: "CRM",
        created_at: "2026-05-27T03:00:00.000Z",
      },
      {
        lead_id: "lead_1",
        status: "delivered",
        destination_label: "CRM",
        created_at: "2026-05-27T04:00:00.000Z",
      },
    ],
  });

  assert.equal(result.rows[0].source, "Meta lead form");
  assert.equal(result.rows[0].quality, "high_intent");
  assert.equal(result.rows[0].delivery, "Delivered to CRM");
  assert.equal(result.rows[0].duplicateCandidate, true);
  assert.equal(result.rows[0].attribution, "Seller checklist");
  assert.equal(result.incoming.duplicateIds.length, 0);
});

test("normalizeLeadQualityLabel accepts shared vocabulary and legacy display labels", () => {
  assert.equal(normalizeLeadQualityLabel("valid"), "valid");
  assert.equal(normalizeLeadQualityLabel("Invalid"), "invalid");
  assert.equal(normalizeLeadQualityLabel("High intent"), "high_intent");
  assert.equal(normalizeLeadQualityLabel("Unqualified"), "invalid");
  assert.equal(normalizeLeadQualityLabel("nurture"), null);
});

test("buildApprovalRows and buildAgentRunRows keep queues workspace backed", () => {
  assert.deepEqual(
    buildApprovalRows([
      {
        id: "approval_1",
        workspace_id: "workspace_1",
        target_type: "campaign",
        status: "requested",
        risk_summary: "Housing targeting review",
        workspaces: { name: "Northstar" },
      },
    ]),
    [
      {
        id: "approval_1",
        workspaceId: "workspace_1",
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

test("AI ledger loaders expose operator filters for user model task and day", () => {
  const liveData = readFileSync("src/lib/product/live-data.ts", "utf8");
  const route = readFileSync("src/app/api/ai-ledger/route.ts", "utf8");
  const page = readFileSync("src/app/(workforce)/model-control/page.tsx", "utf8");

  assert.match(liveData, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(liveData, /\.eq\("user_id", filters\.userId\)/);
  assert.match(liveData, /\.ilike\("model", `%\$\{filters\.model\}%`\)/);
  assert.match(liveData, /\.eq\("task", filters\.task\)/);
  assert.match(liveData, /\.gte\("created_at", dayRange\.startIso\)\.lt\("created_at", dayRange\.endIso\)/);
  assert.match(route, /userId: cleanParam\(request\.nextUrl\.searchParams\.get\("userId"\)\)/);
  assert.match(route, /listAiLedgerRows\(supabase, access\.access\.isOperator \? undefined : access\.access\.workspaceId, filters\)/);
  assert.match(page, /name="userId"/);
  assert.match(page, /name="model"/);
  assert.match(page, /name="task"/);
  assert.match(page, /name="day"/);
});

test("operator overview does not select phantom lead columns", () => {
  const liveData = readFileSync("src/lib/product/live-data.ts", "utf8");

  assert.match(liveData, /\.select\("id,workspace_id,full_name,email,provider,created_at,workspaces\(name\)"\)/);
  assert.doesNotMatch(liveData, /full_name,name,email/);
  assert.doesNotMatch(liveData, /lead\.name/);
});

test("operator AI ledger and agent-run surfaces omit workspace filters for operators only", () => {
  const modelControlPage = readFileSync("src/app/(workforce)/model-control/page.tsx", "utf8");
  const agentsPage = readFileSync("src/app/(workforce)/agents/page.tsx", "utf8");
  const aiLedgerRoute = readFileSync("src/app/api/ai-ledger/route.ts", "utf8");
  const agentRunsRoute = readFileSync("src/app/api/agent-runs/route.ts", "utf8");
  const runDetailPage = readFileSync("src/app/(workforce)/model-control/runs/[id]/page.tsx", "utf8");

  assert.match(modelControlPage, /listAiLedgerRows\(supabase, access\.isOperator \? undefined : access\.workspaceId, ledgerFilters\)/);
  assert.match(agentsPage, /const workspaceId = access\.isOperator \? undefined : access\.workspaceId/);
  assert.match(agentsPage, /listAgentRunRows\(supabase, workspaceId\)/);
  assert.match(aiLedgerRoute, /access\.access\.isOperator \? undefined : access\.access\.workspaceId/);
  assert.match(agentRunsRoute, /access\.access\.isOperator \? undefined : access\.access\.workspaceId/);
  assert.match(runDetailPage, /if \(!access\.isOperator\) \{\s*providerRunQuery = providerRunQuery\.eq\("workspace_id", access\.workspaceId\);/);
  assert.match(runDetailPage, /const traceWorkspaceId = run\.workspace_id/);
  assert.match(runDetailPage, /\.eq\("workspace_id", traceWorkspaceId\)/);
});

test("cockpit metric cards use live data instead of hardcoded counts", () => {
  const agentsPage = readFileSync("src/app/(workforce)/agents/page.tsx", "utf8");
  const approvalsPage = readFileSync("src/app/(customer)/approvals/page.tsx", "utf8");
  const modelControlPage = readFileSync("src/app/(workforce)/model-control/page.tsx", "utf8");

  assert.match(agentsPage, /from\("agent_runs"\)[\s\S]*select\("id", \{ count: "exact", head: true \}\)[\s\S]*\.in\("status", \["queued", "running", "needs_review"\]\)/);
  assert.match(agentsPage, /from\("agent_schedules"\)[\s\S]*select\("id", \{ count: "exact", head: true \}\)[\s\S]*\.eq\("enabled", true\)/);
  assert.match(agentsPage, /value=\{String\(openRuns \?\? 0\)\}/);
  assert.match(agentsPage, /value=\{String\(enabledSchedules \?\? 0\)\}/);
  assert.match(agentsPage, /<tr key=\{run\.id\}>/);
  assert.doesNotMatch(agentsPage, /value="27"|value="6"|key=\{`\$\{run\.agent\}-\$\{run\.status\}`\}/);

  assert.doesNotMatch(approvalsPage, /Budget changes|Client sends|value="1"|value="0"/);

  assert.match(modelControlPage, /configuredProviderNames\.length/);
  assert.doesNotMatch(modelControlPage, /label="Providers" value="2"/);
});
