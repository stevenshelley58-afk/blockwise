import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCaptureJournal, loadCaptureJournal, ensureFetchRun } from "../hermes/tools/research-runtime/bin/ad-radar-capture-journal.mjs";

const RUN = "11111111-1111-4111-8111-111111111111";
const PAGE = "123456789";
const input = { adFetchRunId: RUN, metaPageId: PAGE };
async function temp(fn) { const root = await mkdtemp(join(tmpdir(), "ad-radar-journal-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }

test("saves and reloads exact paid response with receipt and checksum", async () => temp(async (root) => { const saved = await saveCaptureJournal(root, input, { body: "<html>ad</html>", receipt: { requestId: "abc", credits: 25 }, status: 200 }); const loaded = await loadCaptureJournal(root, input); assert.equal(loaded.body, "<html>ad</html>"); assert.deepEqual(loaded.receipt, saved.receipt); assert.equal(loaded.sha256, saved.sha256); }));
test("missing journal is recoverably absent", async () => temp(async (root) => assert.equal(await loadCaptureJournal(root, input), null)));
test("different page cannot replay a saved body", async () => temp(async (root) => { await saveCaptureJournal(root, input, { body: "x", receipt: {}, status: 200 }); await assert.rejects(loadCaptureJournal(root, { ...input, metaPageId: "987" }), /identity|checksum/); }));
test("different run cannot replay a saved body", async () => temp(async (root) => { await saveCaptureJournal(root, input, { body: "x", receipt: {}, status: 200 }); assert.equal(await loadCaptureJournal(root, { ...input, adFetchRunId: "22222222-2222-4222-8222-222222222222" }), null); }));
test("corrupt body checksum is rejected", async () => temp(async (root) => { await saveCaptureJournal(root, input, { body: "x", receipt: {}, status: 200 }); const path = join(root, "capture-journal", RUN + ".json"); const record = JSON.parse(await readFile(path, "utf8")); record.body = "tampered"; await writeFile(path, JSON.stringify(record)); await assert.rejects(loadCaptureJournal(root, input), /identity|checksum/); }));
test("unsafe run ids never create a journal path", async () => temp(async (root) => { await assert.rejects(saveCaptureJournal(root, { ...input, adFetchRunId: "../../etc/passwd" }, { body: "x", receipt: {}, status: 200 }), /Invalid capture run ID/); }));
test("empty evidence is rejected", async () => temp(async (root) => { await assert.rejects(saveCaptureJournal(root, input, { body: "", receipt: {}, status: 200 }), /Empty capture evidence/); }));
test("ensureFetchRun sends a normal POST with representation return", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; const calls = []; const rest = async (...args) => { calls.push(args); return [{ id: RUN }]; }; assert.equal(await ensureFetchRun(rest, row), RUN); assert.equal(calls.length, 1); assert.equal(calls[0][1], "ad_fetch_runs"); assert.equal(calls[0][2].headers.Prefer, "return=representation"); });
test("ensureFetchRun reuses identity after a real 409 conflict", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; let calls = 0; const rest = async () => { calls += 1; if (calls === 1) throw new Error("HTTP 409 duplicate key"); return [{ id: RUN, advertiser_page_id: "page-a" }]; }; assert.equal(await ensureFetchRun(rest, row), RUN); assert.equal(calls, 2); });
test("ensureFetchRun reuses identity after postgres 23505", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; let calls = 0; const rest = async () => { calls += 1; if (calls === 1) throw new Error("23505 unique violation"); return [{ id: RUN, advertiser_page_id: "page-a" }]; }; assert.equal(await ensureFetchRun(rest, row), RUN); assert.equal(calls, 2); });
test("ensureFetchRun rejects duplicate key attached to another page", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; const rest = async (...args) => args[1] === "ad_fetch_runs" ? Promise.reject(new Error("409")) : [{ id: RUN, advertiser_page_id: "page-b" }]; await assert.rejects(ensureFetchRun(rest, row), /identity/); });
test("ensureFetchRun rejects missing duplicate lookup", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; let calls = 0; const rest = async () => (++calls === 1 ? Promise.reject(new Error("409")) : []); await assert.rejects(ensureFetchRun(rest, row), /identity/); });
test("non-conflict POST failures reject without lookup or retry", async () => { const row = { idempotency_key: "k", advertiser_page_id: "page-a" }; const calls = []; const rest = async (...args) => { calls.push(args); throw new Error("503 unavailable"); }; await assert.rejects(ensureFetchRun(rest, row), /503/); assert.equal(calls.length, 1); assert.equal(calls[0][1], "ad_fetch_runs"); });
const {reconcileSavedCaptureSettlement} = await import("../hermes/tools/research-runtime/bin/ad-radar-capture-journal.mjs");
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const settled = {attempt_id:ATTEMPT,run_id:RUN,provider:"scrapingbee",status:"settled",
  outcome:"unparseable",charge_known:true,actual_credits:"25.0000",reserved_credits:25,run_credit_cap:25};
const receipt = {chargeKnown:true,credits:25};
function replay(attempt, savedReceipt=receipt) {
  const calls=[];
  return {calls,run:()=>reconcileSavedCaptureSettlement({
    attemptId:ATTEMPT,runId:RUN,receipt:savedReceipt,outcome:"success",
    rest:async(_schema,path)=>{calls.push({read:path});return attempt === null ? [] : [attempt];},
    settle:async values=>calls.push({settle:values}),
  })};
}
test("improved parser result preserves settled unparseable receipt without another settlement",async()=>{
  const check=replay(settled);
  assert.deepEqual(await check.run(),{settlement:"skipped_already_settled",ledgerOutcome:"unparseable"});
  assert.equal(check.calls.length,1);
  assert.match(check.calls[0].read,/provider=eq.scrapingbee/);
});
test("interrupted reserved attempt with null financial fields settles the verified saved receipt once",async()=>{
  const check=replay({...settled,status:"reserved",outcome:null,charge_known:null,actual_credits:null});
  assert.equal((await check.run()).settlement,"settled");
  assert.equal(check.calls.length,2);
  assert.deepEqual(check.calls[1].settle,{p_attempt_id:ATTEMPT,p_outcome:"success",p_charge_known:true,p_actual_credits:25});
});
test("missing wrong-run and mismatched saved receipts never settle or fetch",async()=>{
  for(const row of [null,{...settled,run_id:ATTEMPT},{...settled,provider:"other"},
    {...settled,actual_credits:24},{...settled,charge_known:false},{...settled,status:"invalid"}]){
    const check=replay(row);await assert.rejects(check.run);assert.equal(check.calls.length,1);
  }
});
test("known zero is not a missing ledger credit amount",async()=>{
  const check=replay({...settled,actual_credits:null},{chargeKnown:true,credits:0});
  await assert.rejects(check.run,/receipt mismatch/);assert.equal(check.calls.length,1);
  assert.equal((await replay({...settled,actual_credits:0},{chargeKnown:true,credits:0}).run()).settlement,"skipped_already_settled");
});
test("reserved receipt cannot exceed its existing reservation",async()=>{
  const check=replay({...settled,status:"reserved",charge_known:null,actual_credits:null},{chargeKnown:true,credits:26});
  await assert.rejects(check.run,/exceeds reservation/);assert.equal(check.calls.length,1);
});
test("unknown saved charge preserves null instead of inventing zero",async()=>{
  const check=replay({...settled,charge_known:false,actual_credits:null},{chargeKnown:false,credits:null});
  assert.equal((await check.run()).settlement,"skipped_already_settled");
  const reserved=replay({...settled,status:"reserved",charge_known:null,actual_credits:null},{chargeKnown:false,credits:null});
  await reserved.run();assert.equal(reserved.calls[1].settle.p_actual_credits,null);
});
test("supervisor saved branch reconciles ledger and never launches a paid attempt",async()=>{
  const source=await readFile("hermes/tools/research-runtime/bin/supabase-supervisor.mjs","utf8");
  const branch=source.slice(source.indexOf("  if (savedCapture) {"),source.indexOf("  const params = new URLSearchParams({",source.indexOf("  if (savedCapture) {")));
  assert.match(branch,/reconcileSavedCaptureSettlement/);
  assert.doesNotMatch(branch,/fetch\(|executeScrapingBeePaidAttempt/);
});
