import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const { createCustomerAd, loadCustomerAd, CustomerAdNotFoundError } = await import("../src/lib/adstudio/create-customer-ad.ts");
const { adFormatLabel } = await import("../src/lib/adstudio/library-contract.ts");
const pack = { templateId: "pack-1", semanticColours: {} };

function fakeCreateClient({ insertResult, replay = null }) {
  const calls = [];
  let first = true;
  const client = { calls, from(table) { const call = { table, filters: [] }; calls.push(call); const chain = { insert(row) { call.insert = row; return chain; }, select(fields) { call.select = fields; return chain; }, eq(field, value) { call.filters.push([field, value]); return chain; }, single: async () => { const result = first ? insertResult : { data: replay, error: null }; first = false; return result; } }; return chain; } };
  return client;
}

test("same idempotency key replays one ad while distinct keys create independently", async () => {
  const replayClient = fakeCreateClient({ insertResult: { data: null, error: { code: "23505", message: "duplicate" } }, replay: { id: "ad-existing" } });
  assert.deepEqual(await createCustomerAd(replayClient, "workspace-a", pack, "key-same"), { adId: "ad-existing", workspaceId: "workspace-a" });
  assert.equal(replayClient.calls[0].insert.creation_key, "key-same");
  assert.deepEqual(replayClient.calls[1].filters, [["workspace_id", "workspace-a"], ["creation_key", "key-same"]]);
  const first = fakeCreateClient({ insertResult: { data: { id: "ad-one" }, error: null } });
  const second = fakeCreateClient({ insertResult: { data: { id: "ad-two" }, error: null } });
  assert.equal((await createCustomerAd(first, "workspace-a", pack, "key-one")).adId, "ad-one");
  assert.equal((await createCustomerAd(second, "workspace-a", pack, "key-two")).adId, "ad-two");
  assert.notEqual(first.calls[0].insert.creation_key, second.calls[0].insert.creation_key);
});

test("missing ads are workspace scoped and never silently loaded", async () => {
  const client = { from() { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) }; return chain; } };
  await assert.rejects(() => loadCustomerAd(client, "workspace-a", "ad-missing"), CustomerAdNotFoundError);
});

test("library format labels reflect available placements", () => {
  assert.equal(adFormatLabel(true, true), "Feed + Story");
  assert.equal(adFormatLabel(true, false), "Feed");
  assert.equal(adFormatLabel(false, true), "Story");
  assert.equal(adFormatLabel(false, false), "Feed + Story");
});
