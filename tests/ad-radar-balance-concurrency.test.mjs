import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseScrapingBeeUsage } from "../hermes/tools/research-runtime/bin/scrapingbee-paid-attempt.mjs";

const source = readFileSync(new URL("../hermes/tools/research-runtime/bin/supabase-supervisor.mjs", import.meta.url), "utf8");
const implementation = source.slice(source.indexOf("let scrapingBeeUsageCache ="), source.indexOf("async function assertScrapingBeeBudgetConfiguration"));
test("actual supervisor shares one fresh balance snapshot across concurrent paid reservations", async () => {
  let requests = 0;
  let clock = 100000;
  let fail = false;
  const context = vm.createContext({
    Date: { now: () => clock }, now: () => new Date(clock).toISOString(),
    scrapingBeeApiKey: "fixture", encodeURIComponent, AbortSignal, parseScrapingBeeUsage,
    fetch: async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (fail) throw new Error("fixture outage");
      return { ok: true, json: async () => ({ max_api_credit: 75000, used_api_credit: 325 }) };
    },
  });
  vm.runInContext(implementation, context);
  const read = () => vm.runInContext("scrapingBeeBalanceEvidence()", context);
  const snapshots = await Promise.all([read(), read(), read()]);
  assert.equal(requests, 1);
  assert.equal(snapshots[0], snapshots[1]);
  assert.equal(snapshots[1], snapshots[2]);
  assert.equal(snapshots[0].remaining, 74675);
  await read();
  assert.equal(requests, 1);
  clock += 66000; fail = true;
  await assert.rejects(read(), /fixture outage/);
  fail = false;
  await Promise.all([read(), read()]);
  assert.equal(requests, 3, "failed refresh clears the in-flight promise; next concurrent retry is shared");
});
