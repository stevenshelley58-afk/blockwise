import assert from "node:assert/strict";
import test from "node:test";

import {
  diffForAlerts,
  levelForPct,
  type ServiceStatus,
} from "../src/lib/alerts/paid-service-watchdog.ts";
import {
  runPaidServiceWatchdog,
  type PaidServiceWatchdogDeps,
} from "../src/lib/alerts/paid-service-runner.ts";

test("levelForPct crosses to warn at 80% and critical at 95%", () => {
  assert.equal(levelForPct(79), "ok");
  assert.equal(levelForPct(80), "warn");
  assert.equal(levelForPct(94), "warn");
  assert.equal(levelForPct(95), "critical");
});

test("diffForAlerts escalates on both the WARN and CRITICAL crossings", () => {
  const warn: ServiceStatus = { service: "openrouter-credits", level: "warn", summary: "80%", pctUsed: 80 };
  const critical: ServiceStatus = { service: "openrouter-credits", level: "critical", summary: "96%", pctUsed: 96 };

  // ok -> warn is an escalation (80% emails)
  assert.equal(diffForAlerts({}, [warn]).escalations.length, 1);
  // ok -> critical is an escalation (95% emails)
  assert.equal(diffForAlerts({}, [critical]).escalations.length, 1);
  // warn -> critical is an escalation
  assert.equal(diffForAlerts({ "openrouter-credits": "warn" }, [critical]).escalations.length, 1);
  // staying at warn does not re-alert (anti-spam)
  assert.equal(diffForAlerts({ "openrouter-credits": "warn" }, [warn]).escalations.length, 0);
});

// A minimal Supabase double covering the runner's runtime_settings load + upsert.
function fakeSupabase() {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        upsert: async () => ({ error: null }),
      }),
    }),
  } as unknown as Parameters<typeof runPaidServiceWatchdog>[0];
}

async function runWith(statuses: ServiceStatus[]) {
  const sent: { subject: string }[] = [];
  const deps: PaidServiceWatchdogDeps = {
    collect: async () => statuses,
    send: async (message) => {
      sent.push(message);
      return { email: true, whatsapp: false };
    },
  };
  const result = await runPaidServiceWatchdog(fakeSupabase(), deps);
  return { sent, result };
}

test("runPaidServiceWatchdog emails the owner at the 80% WARN crossing", async () => {
  const { sent, result } = await runWith([
    { service: "openrouter-credits", level: "warn", summary: "80% used", pctUsed: 80 },
  ]);
  assert.equal(sent.length, 1);
  assert.deepEqual(result.escalations, ["openrouter-credits"]);
  assert.deepEqual(result.delivery, { email: true, whatsapp: false });
});

test("runPaidServiceWatchdog emails the owner at the 95% CRITICAL crossing", async () => {
  const { sent } = await runWith([
    { service: "openai-spend", level: "critical", summary: "96% used", pctUsed: 96 },
  ]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /CRITICAL/);
});

test("runPaidServiceWatchdog stays silent when everything is healthy", async () => {
  const { sent, result } = await runWith([
    { service: "openai-api", level: "ok", summary: "reachable", pctUsed: null },
  ]);
  assert.equal(sent.length, 0);
  assert.equal(result.delivery, null);
});
