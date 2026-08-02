import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildMetaPlanMutation,
  executeMetaPlanMutation,
} from "../src/lib/providers/meta-mutations.ts";

test("Meta mutation provider requests have a bounded timeout", () => {
  const source = readFileSync("src/lib/providers/meta-mutations.ts", "utf8");
  assert.match(source, /META_MUTATION_REQUEST_TIMEOUT_MS = 30_000/);
  assert.equal(
    source.match(/signal: AbortSignal\.timeout\(META_MUTATION_REQUEST_TIMEOUT_MS\)/g)?.length,
    2,
  );
});

test("buildMetaPlanMutation creates a separate approval-gated activation request", () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "activate",
    payload: {
      campaignId: "meta_campaign_123",
      adSetIds: ["meta_adset_123"],
      adIds: ["meta_ad_123"],
    },
  });

  assert.equal(mutation.status, "requested");
  assert.equal(mutation.action, "activate");
  assert.equal(mutation.approval.targetType, "meta_publish_plan_mutation");
  assert.match(mutation.approval.riskSummary, /Activate/);
});

test("executeMetaPlanMutation refuses live mutations without approved approval status", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "increase_budget",
    payload: {
      adSetBudgets: [{ adSetId: "meta_adset_123", dailyBudgetMinorUnits: 12000 }],
    },
  });

  await assert.rejects(
    executeMetaPlanMutation({
      mutation,
      approvalStatus: "requested",
      accessToken: "token",
      fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    }),
    /approved approval/,
  );
});

test("executeMetaPlanMutation keeps the campaign paused until child activation and budget updates finish", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "activate",
    payload: {
      campaignId: "meta_campaign_123",
      adSetIds: ["meta_adset_123"],
      adIds: ["meta_ad_123"],
      adSetBudgets: [{ adSetId: "meta_adset_123", dailyBudgetMinorUnits: 12000 }],
    },
  });
  const requests: Array<{
    url: string;
    method: string;
    body: Record<string, unknown>;
    signal: AbortSignal | null | undefined;
  }> = [];
  const configuredStatuses = new Map<string, string>();

  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (url, init) => {
      const objectId = new URL(String(url)).pathname.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        body,
        signal: init?.signal,
      });
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          id: objectId,
          configured_status: configuredStatuses.get(objectId),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (typeof body.status === "string") configuredStatuses.set(objectId, body.status);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.status, "applied");
  const postRequests = requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    postRequests.map((request) => [new URL(request.url).pathname.split("/").at(-1), request.body]),
    [
      ["meta_campaign_123", { status: "PAUSED" }],
      ["meta_adset_123", { daily_budget: "12000" }],
      ["meta_adset_123", { status: "ACTIVE" }],
      ["meta_ad_123", { status: "ACTIVE" }],
      ["meta_campaign_123", { status: "ACTIVE" }],
    ],
  );
  assert.deepEqual(
    requests.filter((request) => request.method === "GET").map((request) => (
      new URL(request.url).pathname.split("/").at(-1)
    )),
    ["meta_campaign_123", "meta_campaign_123", "meta_adset_123", "meta_ad_123"],
  );
  assert.equal(requests.every((request) => request.signal instanceof AbortSignal), true);
});

test("partial activation failure pauses every possibly active object and checkpoints exact provider errors", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    action: "activate",
    payload: {
      campaignId: "campaign_1",
      adSetIds: ["adset_1", "adset_2"],
      adIds: ["ad_1"],
    },
  });
  const requests: Array<{
    objectId: string;
    method: string;
    body: Record<string, unknown>;
    signal: AbortSignal | null | undefined;
  }> = [];
  const checkpoints: Array<{ requestCount: number; responseCount: number; lastStatus?: number }> = [];

  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    onCheckpoint: async (checkpoint) => {
      const recorded = {
        requestCount: checkpoint.requestLog.length,
        responseCount: checkpoint.responseLog.length,
        lastStatus: checkpoint.responseLog.at(-1)?.status,
      };
      checkpoints.push(recorded);
      if (recorded.lastStatus === 500) {
        throw new Error("checkpoint persistence unavailable");
      }
    },
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url));
      const objectId = parsed.pathname.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ objectId, method: init?.method ?? "GET", body, signal: init?.signal });

      if (init?.method === "POST" && objectId === "adset_2" && body.status === "ACTIVE") {
        return new Response(JSON.stringify({ error: { message: "exact child activation failure" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          id: objectId,
          configured_status: "PAUSED",
          effective_status: "CAMPAIGN_PAUSED",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.lastError, "exact child activation failure");
  assert.equal(
    requests.some((request) => request.objectId === "campaign_1" && request.body.status === "ACTIVE"),
    false,
  );
  const failedRequestIndex = requests.findIndex(
    (request) => request.objectId === "adset_2" && request.body.status === "ACTIVE",
  );
  assert.deepEqual(
    requests
      .slice(failedRequestIndex + 1)
      .filter((request) => request.method === "POST")
      .map((request) => [request.objectId, request.body.status]),
    [
      ["campaign_1", "PAUSED"],
      ["adset_1", "PAUSED"],
      ["adset_2", "PAUSED"],
      ["ad_1", "PAUSED"],
    ],
  );
  assert.deepEqual(
    requests.filter((request) => request.method === "GET").map((request) => request.objectId),
    ["campaign_1", "campaign_1", "adset_1", "adset_2", "ad_1"],
  );
  assert.equal(requests.every((request) => request.signal instanceof AbortSignal), true);
  assert.deepEqual(checkpoints[0], { requestCount: 1, responseCount: 0, lastStatus: undefined });
  assert.equal(checkpoints.some((checkpoint) => checkpoint.lastStatus === 500), true);
});

test("activation retries re-establish the paused campaign guard and report an unconfirmed rollback", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    action: "activate",
    payload: {
      campaignId: "campaign_retry",
      adSetIds: ["adset_retry"],
    },
  });
  mutation.status = "applying";
  mutation.requestLog = [{
    step: "activate.campaign_retry",
    method: "POST",
    path: "/campaign_retry",
    body: { status: "ACTIVE" },
    createdAt: "2026-08-02T00:00:00.000Z",
  }];
  const requests: Array<{ objectId: string; method: string; body: Record<string, unknown> }> = [];

  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url));
      const objectId = parsed.pathname.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ objectId, method: init?.method ?? "GET", body });

      if (init?.method === "POST" && objectId === "adset_retry" && body.status === "ACTIVE") {
        return new Response(JSON.stringify({ error: { message: "retry activation failed exactly" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "POST" && objectId === "adset_retry" && body.status === "PAUSED") {
        return new Response(JSON.stringify({ error: { message: "pause rejected" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          configured_status: objectId === "adset_retry" ? "ACTIVE" : "PAUSED",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(requests[0]?.objectId, "campaign_retry");
  assert.deepEqual(requests[0]?.body, { status: "PAUSED" });
  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /^retry activation failed exactly/);
  assert.match(result.lastError ?? "", /Safety pause could not be confirmed for Meta object\(s\): adset_retry\./);
});
