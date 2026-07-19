import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKFORCE_AGENTS,
  canWorkforceAgentPerformAction,
  requiresHumanApproval,
} from "../src/lib/workforce/permissions.ts";
import {
  authorizeWorkforceOperation,
  buildWorkforceRuntimePolicy,
  detectSensitiveText,
} from "../src/lib/workforce/runtime-policy.ts";

test("research agents can capture evidence but cannot publish ads", () => {
  const research = WORKFORCE_AGENTS.find((agent) => agent.key === "research_agent");

  assert.ok(research);
  assert.equal(canWorkforceAgentPerformAction(research.key, "capture_public_evidence"), true);
  assert.equal(canWorkforceAgentPerformAction(research.key, "publish_provider_campaign"), false);
});

test("high risk actions always require human approval", () => {
  assert.equal(requiresHumanApproval("publish_provider_campaign"), true);
  assert.equal(requiresHumanApproval("change_campaign_budget"), true);
  assert.equal(requiresHumanApproval("export_lead_pii"), true);
  assert.equal(requiresHumanApproval("draft_campaign"), false);
});

test("campaign draft agent can draft campaigns but cannot send client-facing messages", () => {
  assert.equal(canWorkforceAgentPerformAction("campaign_draft_agent", "draft_campaign"), true);
  assert.equal(canWorkforceAgentPerformAction("campaign_draft_agent", "send_client_message"), false);
});

test("agent runtime policies allow scoped internal work only inside the active workspace", () => {
  const policy = buildWorkforceRuntimePolicy({
    workspaceId: "workspace_a",
    agentRunId: "agent_run_1",
    actorProfileId: "operator_1",
    agentKey: "campaign_draft_agent",
  });

  assert.deepEqual(
    authorizeWorkforceOperation(policy, {
      action: "draft_campaign",
      workspaceId: "workspace_a",
      dataClasses: ["campaign_draft"],
      destination: "internal_artifact",
      outboundDomain: "api.openai.com",
      rowCount: 1,
    }),
    { allowed: true },
  );

  assert.deepEqual(
    authorizeWorkforceOperation(policy, {
      action: "draft_campaign",
      workspaceId: "workspace_b",
      dataClasses: ["campaign_draft"],
      destination: "internal_artifact",
      outboundDomain: "api.openai.com",
      rowCount: 1,
    }),
    {
      allowed: false,
      reason: "Agents cannot access another workspace without an explicit cross-workspace grant.",
    },
  );
});

test("agent runtime policies deny unapproved PII exports and unlisted outbound domains", () => {
  const policy = buildWorkforceRuntimePolicy({
    workspaceId: "workspace_a",
    agentRunId: "agent_run_2",
    actorProfileId: "operator_1",
    agentKey: "reporting_agent",
  });

  assert.deepEqual(
    authorizeWorkforceOperation(policy, {
      action: "export_lead_pii",
      workspaceId: "workspace_a",
      dataClasses: ["lead_pii"],
      destination: "external_export",
      outboundDomain: "files.example.com",
      approvalId: "approval_1",
      rowCount: 10,
    }),
    {
      allowed: false,
      reason: "Agent reporting_agent is not allowed to perform export_lead_pii.",
    },
  );

  assert.deepEqual(
    authorizeWorkforceOperation(policy, {
      action: "summarize_reporting",
      workspaceId: "workspace_a",
      dataClasses: ["performance_metrics"],
      destination: "model_prompt",
      outboundDomain: "unapproved.example.com",
      rowCount: 5,
    }),
    {
      allowed: false,
      reason: "Outbound domain unapproved.example.com is not in this agent policy allowlist.",
    },
  );
});

test("agent runtime policies allow curated direct Gemini model egress", () => {
  const policy = buildWorkforceRuntimePolicy({
    workspaceId: "workspace_a",
    agentRunId: "agent_run_3",
    actorProfileId: "operator_1",
    agentKey: "campaign_draft_agent",
  });

  assert.deepEqual(
    authorizeWorkforceOperation(policy, {
      action: "draft_campaign",
      workspaceId: "workspace_a",
      dataClasses: ["campaign_draft"],
      destination: "model_prompt",
      outboundDomain: "generativelanguage.googleapis.com",
      rowCount: 1,
    }),
    { allowed: true },
  );
});

test("sensitive text detection flags customer PII and secrets before model prompts or artifacts", () => {
  assert.deepEqual(
    detectSensitiveText("Email amelia@example.com or call 0400 111 222 with sk-live-secret"),
    ["email", "au_phone", "secret"],
  );
});
