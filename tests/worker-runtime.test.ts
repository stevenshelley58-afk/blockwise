import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildMetaPlanMutation,
  executeMetaPlanMutation,
} from "../src/lib/providers/meta-mutations.ts";
import { runOnce } from "../worker/index.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

const workspaceId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const leaseToken = "33333333-3333-4333-8333-333333333333";

function claimedJob(kind = "publish.meta.execute") {
  return {
    id: jobId,
    workspace_id: workspaceId,
    kind,
    payload: { workspaceId, planId: "44444444-4444-4444-8444-444444444444" },
    attempts: 1,
    max_attempts: 3,
    lease_token: leaseToken,
  };
}

function fakeService(
  responder: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
) {
  const calls: RpcCall[] = [];
  const service = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return responder(name, args);
    },
  };
  return {
    calls,
    service: service as unknown as Parameters<typeof runOnce>[0],
  };
}

test("handler-resolution failures are settled through fail_job_v2", async () => {
  const { calls, service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob()], error: null };
    if (name === "fail_job_v2") return { data: "pending", error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  const handled = await runOnce(service, {
    resolveHandler: async () => {
      throw new Error("simulated module import failure");
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls[0], {
    name: "claim_job_v2",
    args: { p_kind: null, p_lease_seconds: 600 },
  });
  assert.deepEqual(calls.at(-1), {
    name: "fail_job_v2",
    args: {
      p_workspace_id: workspaceId,
      p_id: jobId,
      p_lease_token: leaseToken,
      p_error: "simulated module import failure",
    },
  });
  assert.equal(calls.some((call) => call.name === "complete_job_v2"), false);
});

test("long-running handlers heartbeat the workspace-fenced lease", async () => {
  const { calls, service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob("reporting.refresh")], error: null };
    if (name === "heartbeat_job") return { data: true, error: null };
    if (name === "complete_job_v2") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  await runOnce(service, {
    heartbeatEveryMs: 5,
    leaseSeconds: 30,
    resolveHandler: async () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    },
  });

  const heartbeats = calls.filter((call) => call.name === "heartbeat_job");
  assert.ok(heartbeats.length >= 1);
  for (const heartbeat of heartbeats) {
    assert.deepEqual(heartbeat.args, {
      p_workspace_id: workspaceId,
      p_id: jobId,
      p_lease_token: leaseToken,
      p_lease_seconds: 30,
    });
  }
  assert.deepEqual(calls.at(-1), {
    name: "complete_job_v2",
    args: {
      p_workspace_id: workspaceId,
      p_id: jobId,
      p_lease_token: leaseToken,
    },
  });
});

test("lease loss aborts in-flight provider I/O and is never settled by the stale worker", async () => {
  const { calls, service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob()], error: null };
    if (name === "heartbeat_job") return { data: false, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  const providerFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

  await assert.rejects(
    runOnce(service, {
      heartbeatEveryMs: 5,
      heartbeatTimeoutMs: 50,
      leaseSeconds: 30,
      fetchImpl: providerFetch,
      resolveHandler: async () => async (_payload, _service, context) => {
        await context.fetchImpl("https://graph.facebook.invalid/provider-write", { method: "POST" });
      },
    }),
    /heartbeat_job lost the lease/,
  );

  assert.equal(calls.some((call) => call.name === "complete_job_v2"), false);
  assert.equal(calls.some((call) => call.name === "fail_job_v2"), false);
});

test("lease loss waits for bounded PAUSE-only Meta activation compensation", async () => {
  let leaseLost = false;
  const { calls, service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob("publish.meta.mutate")], error: null };
    if (name === "heartbeat_job") {
      leaseLost = true;
      return { data: false, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const afterLeaseLoss: Array<{
    objectId: string;
    method: string;
    status?: unknown;
    redirect?: RequestRedirect;
  }> = [];
  let ordinaryActiveRequestAborted = false;
  let handlerFinished = false;

  const providerFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const objectId = url.pathname.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

    if (body.status === "ACTIVE") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          ordinaryActiveRequestAborted = true;
          reject(init.signal?.reason);
        }, { once: true });
      });
    }

    if (leaseLost) {
      afterLeaseLoss.push({
        objectId,
        method: init?.method ?? "GET",
        status: body.status,
        redirect: init?.redirect,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (init?.method === "GET") {
      return new Response(JSON.stringify({ configured_status: "PAUSED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await assert.rejects(
    runOnce(service, {
      heartbeatEveryMs: 5,
      heartbeatTimeoutMs: 50,
      leaseSeconds: 30,
      fetchImpl: providerFetch,
      resolveHandler: async () => async (_payload, _service, context) => {
        const mutation = buildMetaPlanMutation({
          workspaceId,
          planId: "44444444-4444-4444-8444-444444444444",
          action: "activate",
          payload: { campaignId: "1001", adSetIds: ["1002"] },
        });
        const result = await executeMetaPlanMutation({
          mutation,
          approvalStatus: "approved",
          accessToken: "token",
          fetchImpl: context.fetchImpl,
          compensationFetchImpl: context.metaActivationCompensationFetchImpl,
        });
        assert.equal(result.status, "failed");
        const compensationFetchImpl = context.metaActivationCompensationFetchImpl;
        assert.ok(compensationFetchImpl);
        for (const [url, init] of [
          [
            "https://graph.facebook.com/v23.0/1001",
            { method: "POST", body: JSON.stringify({ status: "ACTIVE" }) },
          ],
          [
            "https://example.invalid/v23.0/1001",
            { method: "POST", body: JSON.stringify({ status: "PAUSED" }) },
          ],
          [
            "https://graph.facebook.com/v23.0/1001",
            { method: "DELETE" },
          ],
        ] as const) {
          await assert.rejects(
            compensationFetchImpl(url, init),
            /permits only PAUSED writes/,
          );
        }
        handlerFinished = true;
      },
    }),
    /heartbeat_job lost the lease/,
  );

  assert.equal(ordinaryActiveRequestAborted, true);
  assert.equal(handlerFinished, true, "runOnce must drain activation compensation before returning");
  assert.deepEqual(
    afterLeaseLoss.filter((request) => request.method === "POST"),
    [
      { objectId: "1001", method: "POST", status: "PAUSED", redirect: "error" },
      { objectId: "1002", method: "POST", status: "PAUSED", redirect: "error" },
    ],
  );
  assert.equal(afterLeaseLoss.every((request) => request.redirect === "error"), true);
  assert.equal(calls.some((call) => call.name === "complete_job_v2"), false);
  assert.equal(calls.some((call) => call.name === "fail_job_v2"), false);
});

test("a never-resolving heartbeat cannot freeze worker shutdown or completion", async () => {
  const { calls, service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob("reporting.refresh")], error: null };
    if (name === "heartbeat_job") return new Promise(() => undefined);
    if (name === "complete_job_v2") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  await runOnce(service, {
    heartbeatEveryMs: 5,
    heartbeatTimeoutMs: 20,
    leaseSeconds: 30,
    resolveHandler: async () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    },
  });

  assert.equal(calls.some((call) => call.name === "heartbeat_job"), true);
  assert.equal(calls.at(-1)?.name, "complete_job_v2");
});

test("worker lease validation matches the database clamp", async () => {
  const { service } = fakeService(async () => ({ data: [], error: null }));
  await assert.rejects(
    runOnce(service, { leaseSeconds: 29 }),
    /between 30 and 3600 seconds/,
  );
  await assert.rejects(
    runOnce(service, { leaseSeconds: 3_601 }),
    /between 30 and 3600 seconds/,
  );
});

test("completion rejects a stale or mismatched lease", async () => {
  const { service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob()], error: null };
    if (name === "complete_job_v2") return { data: false, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  await assert.rejects(
    runOnce(service, { resolveHandler: async () => async () => undefined }),
    /complete_job_v2 lost the lease/,
  );
});

test("completion surfaces settlement RPC errors instead of logging success", async () => {
  const { service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob()], error: null };
    if (name === "complete_job_v2") return { data: null, error: { message: "database unavailable" } };
    throw new Error(`Unexpected RPC ${name}`);
  });

  await assert.rejects(
    runOnce(service, { resolveHandler: async () => async () => undefined }),
    /complete_job_v2 failed: database unavailable/,
  );
});

test("failure settlement rejects a stale or mismatched lease", async () => {
  const { service } = fakeService(async (name) => {
    if (name === "claim_job_v2") return { data: [claimedJob()], error: null };
    if (name === "fail_job_v2") return { data: null, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });

  await assert.rejects(
    runOnce(service, {
      resolveHandler: async () => {
        throw new Error("handler failed");
      },
    }),
    /fail_job_v2 lost the lease/,
  );
});

test("preflight loads publish and reporting handlers without printing credentials", () => {
  const revision = "a".repeat(40);
  const workerPath = fileURLToPath(new URL("../worker/index.ts", import.meta.url));
  const secretSentinel = "must-not-appear-in-output";
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      workerPath,
      "--preflight",
      "--expect-revision",
      revision,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BLOCKWISE_WORKER_REVISION: revision,
        BLOCKWISE_ENABLE_PROVIDER_WRITES: "true",
        BLOCKWISE_QUEUED_KINDS: "",
        SUPABASE_URL: "https://worker-preflight.invalid",
        SUPABASE_SECRET_KEY: secretSentinel,
        TOKEN_ENCRYPTION_KEY: secretSentinel,
        STRIPE_SECRET_KEY: secretSentinel,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secretSentinel), false);
  const report = JSON.parse(result.stdout) as {
    status: string;
    revision: string;
    handlers: Record<string, string>;
    routing: { vpsOnly: boolean };
  };
  assert.equal(report.status, "ready");
  assert.equal(report.revision, revision);
  assert.equal(report.handlers["publish.meta.execute"], "loaded");
  assert.equal(report.handlers["reporting.refresh"], "loaded");
  assert.equal(report.routing.vpsOnly, true);
});

test("preflight does not block non-legacy jobs when optional Stripe billing is unavailable", () => {
  const revision = "b".repeat(40);
  const workerPath = fileURLToPath(new URL("../worker/index.ts", import.meta.url));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BLOCKWISE_WORKER_REVISION: revision,
    BLOCKWISE_ENABLE_PROVIDER_WRITES: "true",
    SUPABASE_URL: "https://worker-preflight.invalid",
    SUPABASE_SECRET_KEY: "preflight-secret",
    TOKEN_ENCRYPTION_KEY: "preflight-secret",
  };
  delete env.STRIPE_SECRET_KEY;

  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      workerPath,
      "--preflight",
      "--expect-revision",
      revision,
    ],
    { encoding: "utf8", env },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    status: string;
    runtime: { stripeSecretKeyPresent: boolean };
  };
  assert.equal(report.status, "ready");
  assert.equal(report.runtime.stripeSecretKeyPresent, false);
});
