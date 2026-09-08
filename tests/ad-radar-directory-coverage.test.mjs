import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDirectoryCoveragePlan,
  handleAdRadarEntityDiscovery,
  handleAdRadarPageDiscovery,
  enqueueAdRadarDirectoryDiscovery,
  enumerateDirectoryPages,
  extractExactFacebookLinks,
  extractFacebookLinksFromHtml,
  facebookPageIdFromHtml,
  facebookPageReference,
  readDirectoryCheckpoint,
  writeDirectoryCheckpoint,
} from "../hermes/tools/research-runtime/bin/ad-radar-directory-coverage.mjs";

async function temp(fn) {
  const root = await mkdtemp(join("/tmp", "ad-radar-directory-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function pageRows(kind, index, size) {
  const rows = kind === "agent" ? [{ id: "a-1", full_name: "Agent One", state: "WA" }, { id: "a-2", full_name: "Agent Two", state: "WA" }] : [{ id: "g-1", name: "Agency One", state: "WA" }];
  return { rows: rows.slice(index * size, (index + 1) * size), totalRecords: rows.length };
}

test("enumerates every authoritative page without an arbitrary first-page cap", async () => {
  const calls = [];
  const result = await enumerateDirectoryPages({ kinds: ["agent"], pageSize: 1, fetchPage: async (kind, index, size) => { calls.push([kind, index, size]); return pageRows(kind, index, size); } });
  assert.deepEqual(calls, [["agent", 0, 1], ["agent", 1, 1]]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.checkpoint.kinds.agent.completedPages, [0, 1]);
});

test("resumes from durable page checkpoint and reuses saved rows", async () => {
  const calls = [];
  const checkpoint = { version: "old", kinds: { agent: { pageSize: 2, totalRecords: 3, completedPages: [0], rowCounts: { "0": 2 }, pageDigests: {}, rowsByPage: { "0": [{ id: "a-1" }, { id: "a-2" }] }, exhausted: false } } };
  const result = await enumerateDirectoryPages({ kinds: ["agent"], pageSize: 2, checkpoint, fetchPage: async (_kind, index) => { calls.push(index); return { rows: [{ id: "a-3" }], totalRecords: 3 }; } });
  assert.deepEqual(calls, [1]);
  assert.deepEqual(result.rows.map((row) => row.id), ["a-1", "a-2", "a-3"]);
  assert.deepEqual(result.checkpoint.kinds.agent.completedPages, [0, 1]);
});

test("changed authoritative totals fail closed rather than claiming complete coverage", async () => {
  const checkpoint = { kinds: { agent: { pageSize: 2, totalRecords: 4, completedPages: [0], rowCounts: { "0": 2 }, rowsByPage: { "0": [{ id: "a-1" }, { id: "a-2" }] }, exhausted: false } } };
  await assert.rejects(() => enumerateDirectoryPages({ kinds: ["agent"], pageSize: 2, checkpoint, fetchPage: async () => ({ rows: [{ id: "a-3" }], totalRecords: 5 }) }), /totalRecords changed/iu);
});

test("malformed page responses do not advance checkpoint", async () => {
  const checkpoint = {};
  await assert.rejects(() => enumerateDirectoryPages({ kinds: ["agency"], checkpoint, fetchPage: async () => ({ data: [] }) }), /rows\[\]/iu);
  assert.deepEqual(checkpoint, {});
});

test("checkpoint writes are atomic and round-trip durable rows", async () => temp(async (root) => {
  const path = join(root, "nested", "checkpoint.json");
  await writeDirectoryCheckpoint(path, { entityCursor: 4, kinds: { agent: { completedPages: [0], rowCounts: { "0": 1 }, rowsByPage: { "0": [{ id: "a" }] }, exhausted: true } } });
  const loaded = await readDirectoryCheckpoint(path);
  assert.equal(loaded.entityCursor, 4);
  assert.deepEqual(loaded.kinds.agent.rowsByPage["0"], [{ id: "a" }]);
}));

test("extracts numeric PageIDs but keeps vanity links unresolved", () => {
  assert.deepEqual(facebookPageReference("https://facebook.com/pages/Brand/123456"), { url: "https://www.facebook.com/123456", pageId: "123456", vanity: null, reason: null });
  assert.equal(facebookPageReference("https://facebook.com/brand-name").pageId, null);
  assert.equal(facebookPageReference("https://facebook.com/groups/123456").reason, "non_page_facebook_path");
  assert.equal(facebookPageReference("https://facebook.com/profile.php?id=123456").pageId, "123456");
});

test("extracts official links from HTML and resolves an authoritative page id", () => {
  const links = extractFacebookLinksFromHtml("https://agency.example/about", '<a href="https://www.facebook.com/acme">Facebook</a><a href="https://facebook.com/share/x">share</a>');
  assert.equal(links.length, 1);
  assert.equal(links[0].vanity, "acme");
  assert.equal(facebookPageIdFromHtml('{"userID":"123456","userVanity":"acme"}', "acme"), "123456");
});

test("agency exact official link becomes a candidate and existing exact ownership is covered", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [{ kind: "agency", id: "g-1", name: "Acme", state: "WA", primary_postcode: "6000" }],
    sourceLinks: [{ entityKind: "agency", entityId: "g-1", ownerKind: "agency", isOfficial: true, url: "https://facebook.com/acme/123456", sourceDocumentId: "doc-1" }],
    existingPages: [{ entityKind: "agency", entityId: "g-1", pageId: "123456" }],
  });
  assert.equal(plan.covered, 1);
  assert.equal(plan.rows[0].status, "covered");
});

test("agent profile or footer agency link never proves agent ownership", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [{ kind: "agent", id: "a-1", full_name: "Agent One", state: "WA" }],
    sourceLinks: [{ entityKind: "agent", entityId: "a-1", ownerKind: "agency", isOfficial: true, url: "https://facebook.com/agency/123456", sourceType: "agent_profile_footer" }],
  });
  assert.equal(plan.unmapped, 1);
  assert.equal(plan.rows[0].rejected[0].reason, "agent_profile_link_not_ownership");
});

test("ambiguous links and non-WA entities remain review gaps without name matching", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [
      { kind: "agency", id: "g-1", name: "Acme", state: "WA" },
      { kind: "agency", id: "g-2", name: "Acme", state: "NSW" },
    ],
    sourceLinks: [
      { entityKind: "agency", entityId: "g-1", ownerKind: "agency", isOfficial: true, url: "https://facebook.com/one/123456" },
      { entityKind: "agency", entityId: "g-1", ownerKind: "agency", isOfficial: true, url: "https://facebook.com/two/789012" },
      { entityKind: "agency", entityId: "g-2", ownerKind: "agency", isOfficial: true, url: "https://facebook.com/other/999999" },
    ],
  });
  assert.equal(plan.eligibleEntities, 1);
  assert.equal(plan.ambiguous, 1);
  assert.equal(plan.rows[0].candidates.length, 2);
});

test("directory discovery enqueue is canonical and idempotent for active work", async () => {
  const calls = [];
  const result = await enqueueAdRadarDirectoryDiscovery({ buildRunId: "run-1", now: () => "2026-09-08T00:00:00.000Z", rest: async (schema, path, options) => {
    calls.push([schema, path, options]);
    if (path.startsWith("work_queue?")) return [{ id: "job-1", status: "claimed" }];
    throw new Error("unexpected write");
  } });
  assert.equal(result.enqueued, false);
  assert.equal(result.jobId, "job-1");
  assert.equal(calls.length, 1);
});

test("entity discovery registers an exact official agency page for collection", async () => {
  const writes = [];
  const rest = async (_schema, path, options) => {
    if (path.startsWith("source_documents?select=id,source")) return [];
    if (path.startsWith("source_documents?select=id&")) return [];
    if (path === "source_documents") { writes.push([path, JSON.parse(options.body)]); return [{ id: "doc-1" }]; }
    if (path.startsWith("advertiser_pages?select=")) return [];
    if (path === "advertiser_pages") { writes.push([path, JSON.parse(options.body)]); return [{ id: "page-1" }]; }
    throw new Error(`unexpected ${path}`);
  };
  const result = await handleAdRadarEntityDiscovery({ id: "job-1", payload: { entity_kind: "agency", entity_id: "g-1", name: "Acme", state: "WA", primary_postcode: "6000", website_url: "https://acme.example" } }, { rest, rawEvidenceDir: "/tmp/ad-radar-directory-test", fetchImpl: async () => ({ ok: true, text: async () => '<a href="https://facebook.com/acme/123456">Facebook</a>' }) });
  assert.equal(result.result.registered_pages, 1);
  assert.equal(writes.filter(([path]) => path === "advertiser_pages").length, 1);
  assert.equal(writes.find(([path]) => path === "advertiser_pages")[1].page_id, "123456");
});

test("cached official source links avoid website fetch and repeat job does not insert another page", async () => {
  let fetches = 0; let pagePosts = 0; let pagePatches = 0;
  const rest = async (_schema, path, options) => {
    if (path.startsWith("source_documents?select=id,source")) return [{ id: "doc-1", source: "ad_radar_directory_website", metadata: { entity_kind: "agency", entity_id: "g-1", official_facebook_links: ["https://facebook.com/acme/123456"] } }];
    if (path.startsWith("advertiser_pages?select=")) return [{ id: "page-1", page_id: "123456", agency_id: "g-1", agent_id: null, status: "resolved_collectable", scan_enabled: true }];
    if (path.startsWith("advertiser_pages?id=")) { pagePatches += 1; return [{ id: "page-1" }]; }
    if (path === "advertiser_pages") { pagePosts += 1; return [{ id: "page-2" }]; }
    throw new Error(`unexpected ${path}`);
  };
  const options = { rest, rawEvidenceDir: "/tmp/ad-radar-directory-test", fetchImpl: async () => { fetches += 1; throw new Error("network must not be used"); } };
  const job = { id: "job-2", payload: { entity_kind: "agency", entity_id: "g-1", name: "Acme", state: "WA", primary_postcode: "6000", website_url: "https://acme.example" } };
  await handleAdRadarEntityDiscovery(job, options);
  await handleAdRadarEntityDiscovery(job, options);
  assert.equal(fetches, 0);
  assert.equal(pagePosts, 0);
  assert.equal(pagePatches, 2);
});

test("directory sweep enqueues per-entity jobs instead of fetching websites itself", async () => {
  const calls = []; const queued = [];
  const rest = async (_schema, path, options) => {
    calls.push(path);
    if (path.startsWith("work_queue?")) return [];
    if (path.startsWith("agents?")) return [{ id: "a-1", full_name: "Agent One", state: "WA", primary_postcode: "6000", website_url: "https://agent.example" }];
    if (path.startsWith("agencies?")) return [];
    if (path.startsWith("source_documents?")) return [];
    if (path === "work_queue") { queued.push(JSON.parse(options.body)); return [{ id: `job-${queued.length}` }]; }
    throw new Error(`unexpected ${path}`);
  };
  const result = await handleAdRadarPageDiscovery({ id: "sweep-1", payload: { build_run_id: "sweep-1", entity_limit: 10 } }, { rest, rawEvidenceDir: `/tmp/ad-radar-directory-sweep-test-${Date.now()}`, pageSize: 500 });
  assert.equal(result.result.queued_entities, 1);
  assert.equal(queued[0].job_type, "blockwise-ad-directory-discovery-entity");
  assert.equal(calls.some((path) => path.startsWith("source_documents?")), false);
});
