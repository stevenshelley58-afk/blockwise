import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

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
        BLOCKWISE_QUEUED_KINDS: "reporting.refresh",
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
  };
  assert.equal(report.status, "ready");
  assert.equal(report.revision, revision);
  assert.equal(report.handlers["publish.meta.execute"], "loaded");
  assert.equal(report.handlers["reporting.refresh"], "loaded");
});

test("preflight fails closed when reporting.refresh is not queue-routed", () => {
  const revision = "b".repeat(40);
  const workerPath = fileURLToPath(new URL("../worker/index.ts", import.meta.url));
  const secretSentinel = "must-not-appear-in-output";
  const result = spawnSync(
    process.execPath,
    [workerPath, "--preflight", "--expect-revision", revision],
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BLOCKWISE_QUEUED_KINDS=reporting\.refresh/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(secretSentinel), false);
});
