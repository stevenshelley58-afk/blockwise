import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDirectoryCoveragePlan,
  boundedDirectoryFetch,
  isPublicDirectoryAddress,
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
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function pageRows(kind, index, size) {
  const rows =
    kind === "agent"
      ? [
          { id: "a-1", full_name: "Agent One", state: "WA" },
          { id: "a-2", full_name: "Agent Two", state: "WA" },
        ]
      : [{ id: "g-1", name: "Agency One", state: "WA" }];
  return {
    rows: rows.slice(index * size, (index + 1) * size),
    totalRecords: rows.length,
  };
}

test("enumerates every authoritative page without an arbitrary first-page cap", async () => {
  const calls = [];
  const result = await enumerateDirectoryPages({
    kinds: ["agent"],
    pageSize: 1,
    fetchPage: async (kind, index, size) => {
      calls.push([kind, index, size]);
      return pageRows(kind, index, size);
    },
  });
  assert.deepEqual(calls, [
    ["agent", 0, 1],
    ["agent", 1, 1],
  ]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.checkpoint.kinds.agent.completedPages, [0, 1]);
});

test("resumes from durable page checkpoint and reuses saved rows", async () => {
  const calls = [];
  const checkpoint = {
    version: "old",
    kinds: {
      agent: {
        pageSize: 2,
        totalRecords: 3,
        completedPages: [0],
        rowCounts: { 0: 2 },
        pageDigests: {},
        rowsByPage: { 0: [{ id: "a-1" }, { id: "a-2" }] },
        exhausted: false,
      },
    },
  };
  const result = await enumerateDirectoryPages({
    kinds: ["agent"],
    pageSize: 2,
    checkpoint,
    fetchPage: async (_kind, index) => {
      calls.push(index);
      return { rows: [{ id: "a-3" }], totalRecords: 3 };
    },
  });
  assert.deepEqual(calls, [1]);
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ["a-1", "a-2", "a-3"],
  );
  assert.deepEqual(result.checkpoint.kinds.agent.completedPages, [0, 1]);
});

test("changed authoritative totals fail closed rather than claiming complete coverage", async () => {
  const checkpoint = {
    kinds: {
      agent: {
        pageSize: 2,
        totalRecords: 4,
        completedPages: [0],
        rowCounts: { 0: 2 },
        rowsByPage: { 0: [{ id: "a-1" }, { id: "a-2" }] },
        exhausted: false,
      },
    },
  };
  await assert.rejects(
    () =>
      enumerateDirectoryPages({
        kinds: ["agent"],
        pageSize: 2,
        checkpoint,
        fetchPage: async () => ({ rows: [{ id: "a-3" }], totalRecords: 5 }),
      }),
    /totalRecords changed/iu,
  );
});

test("malformed page responses do not advance checkpoint", async () => {
  const checkpoint = {};
  await assert.rejects(
    () =>
      enumerateDirectoryPages({
        kinds: ["agency"],
        checkpoint,
        fetchPage: async () => ({ data: [] }),
      }),
    /rows\[\]/iu,
  );
  assert.deepEqual(checkpoint, {});
});

test("checkpoint writes are atomic and round-trip durable rows", async () =>
  temp(async (root) => {
    const path = join(root, "nested", "checkpoint.json");
    await writeDirectoryCheckpoint(path, {
      entityCursor: 4,
      kinds: {
        agent: {
          completedPages: [0],
          rowCounts: { 0: 1 },
          rowsByPage: { 0: [{ id: "a" }] },
          exhausted: true,
        },
      },
    });
    const loaded = await readDirectoryCheckpoint(path);
    assert.equal(loaded.entityCursor, 4);
    assert.deepEqual(loaded.kinds.agent.rowsByPage["0"], [{ id: "a" }]);
  }));

test("extracts numeric PageIDs but keeps vanity links unresolved", () => {
  assert.deepEqual(
    facebookPageReference("https://facebook.com/pages/Brand/123456"),
    {
      url: "https://www.facebook.com/123456",
      pageId: "123456",
      vanity: null,
      reason: null,
    },
  );
  assert.equal(
    facebookPageReference("https://facebook.com/brand-name").pageId,
    null,
  );
  assert.equal(
    facebookPageReference("https://facebook.com/groups/123456").reason,
    "non_page_facebook_path",
  );
  assert.equal(
    facebookPageReference("https://facebook.com/profile.php?id=123456").pageId,
    "123456",
  );
});

test("extracts official links from HTML and resolves an authoritative page id", () => {
  const links = extractFacebookLinksFromHtml(
    "https://agency.example/about",
    '<a href="https://www.facebook.com/acme">Facebook</a><a href="https://facebook.com/share/x">share</a>',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].vanity, "acme");
  assert.equal(
    facebookPageIdFromHtml(
      '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
      "acme",
    ),
    "123456",
  );
});

test("agency exact official link becomes a candidate and existing exact ownership is covered", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [
      {
        kind: "agency",
        id: "g-1",
        name: "Acme",
        state: "WA",
        primary_postcode: "6000",
      },
    ],
    sourceLinks: [
      {
        entityKind: "agency",
        entityId: "g-1",
        ownerKind: "agency",
        isOfficial: true,
        url: "https://facebook.com/pages/acme/123456",
        sourceDocumentId: "doc-1",
      },
    ],
    existingPages: [
      { entityKind: "agency", entityId: "g-1", pageId: "123456" },
    ],
  });
  assert.equal(plan.covered, 1);
  assert.equal(plan.rows[0].status, "covered");
});

test("agent profile or footer agency link never proves agent ownership", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [
      { kind: "agent", id: "a-1", full_name: "Agent One", state: "WA" },
    ],
    sourceLinks: [
      {
        entityKind: "agent",
        entityId: "a-1",
        ownerKind: "agency",
        isOfficial: true,
        url: "https://facebook.com/pages/agency/123456",
        sourceType: "agent_profile_footer",
      },
    ],
  });
  assert.equal(plan.unmapped, 1);
  assert.equal(
    plan.rows[0].rejected[0].reason,
    "agent_profile_link_not_ownership",
  );
});

test("ambiguous links and non-WA entities remain review gaps without name matching", () => {
  const plan = buildDirectoryCoveragePlan({
    entities: [
      { kind: "agency", id: "g-1", name: "Acme", state: "WA" },
      { kind: "agency", id: "g-2", name: "Acme", state: "NSW" },
    ],
    sourceLinks: [
      {
        entityKind: "agency",
        entityId: "g-1",
        ownerKind: "agency",
        isOfficial: true,
        url: "https://facebook.com/pages/one/123456",
      },
      {
        entityKind: "agency",
        entityId: "g-1",
        ownerKind: "agency",
        isOfficial: true,
        url: "https://facebook.com/pages/two/789012",
      },
      {
        entityKind: "agency",
        entityId: "g-2",
        ownerKind: "agency",
        isOfficial: true,
        url: "https://facebook.com/pages/other/999999",
      },
    ],
  });
  assert.equal(plan.eligibleEntities, 1);
  assert.equal(plan.ambiguous, 1);
  assert.equal(plan.rows[0].candidates.length, 2);
});

test("directory discovery enqueue is canonical and idempotent for active work", async () => {
  const calls = [];
  const result = await enqueueAdRadarDirectoryDiscovery({
    buildRunId: "run-1",
    now: () => "2026-09-08T00:00:00.000Z",
    rest: async (schema, path, options) => {
      calls.push([schema, path, options]);
      if (path.startsWith("work_queue?"))
        return [{ id: "job-1", status: "claimed" }];
      throw new Error("unexpected write");
    },
  });
  assert.equal(result.enqueued, false);
  assert.equal(result.jobId, "job-1");
  assert.equal(calls.length, 1);
});

test("entity discovery registers an exact official agency page for collection", async () => {
  const writes = [];
  const rest = async (_schema, path, options) => {
    if (
      path.startsWith("source_documents?select=id,source") ||
      path.startsWith("source_documents?select=id,metadata")
    )
      return [];
    if (path.startsWith("source_documents?select=id&")) return [];
    if (path === "source_documents") {
      writes.push([path, JSON.parse(options.body)]);
      return [{ id: "doc-1" }];
    }
    if (path.startsWith("advertiser_pages?select=")) return [];
    if (path === "advertiser_pages") {
      writes.push([path, JSON.parse(options.body)]);
      return [{ id: "page-1" }];
    }
    throw new Error(`unexpected ${path}`);
  };
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "job-1",
      payload: {
        entity_kind: "agency",
        entity_id: "g-1",
        name: "Acme",
        state: "WA",
        primary_postcode: "6000",
        website_url: "https://acme.example",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-test",
      fetchImpl: async () => ({
        ok: true,
        text: async () =>
          '<h1>Acme</h1><a href="https://facebook.com/pages/acme/123456">Facebook</a>',
      }),
    },
  );
  assert.equal(result.result.registered_pages, 1);
  assert.equal(
    writes.filter(([path]) => path === "advertiser_pages").length,
    1,
  );
  assert.equal(
    writes.find(([path]) => path === "advertiser_pages")[1].page_id,
    "123456",
  );
});

test("cached official source links avoid website fetch and repeat job does not insert another page", async () => {
  let fetches = 0;
  let pagePosts = 0;
  let pagePatches = 0;
  const rest = async (_schema, path, options) => {
    if (path.startsWith("source_documents?select=id,source"))
      return [
        {
          id: "doc-1",
          source: "ad_radar_directory_website",
          metadata: {
            entity_kind: "agency",
            entity_id: "g-1",
            official_facebook_links: ["https://facebook.com/pages/acme/123456"],
          },
        },
      ];
    if (path.startsWith("advertiser_pages?select="))
      return [
        {
          id: "page-1",
          page_id: "123456",
          agency_id: "g-1",
          agent_id: null,
          status: "resolved_collectable",
          scan_enabled: true,
        },
      ];
    if (path.startsWith("advertiser_pages?id=")) {
      pagePatches += 1;
      return [{ id: "page-1" }];
    }
    if (path === "advertiser_pages") {
      pagePosts += 1;
      return [{ id: "page-2" }];
    }
    throw new Error(`unexpected ${path}`);
  };
  const options = {
    rest,
    rawEvidenceDir: "/tmp/ad-radar-directory-test",
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("network must not be used");
    },
  };
  const job = {
    id: "job-2",
    payload: {
      entity_kind: "agency",
      entity_id: "g-1",
      name: "Acme",
      state: "WA",
      primary_postcode: "6000",
      website_url: "https://acme.example",
    },
  };
  await handleAdRadarEntityDiscovery(job, options);
  await handleAdRadarEntityDiscovery(job, options);
  assert.equal(fetches, 0);
  assert.equal(pagePosts, 0);
  assert.equal(pagePatches, 0);
});

test("directory sweep enqueues per-entity jobs instead of fetching websites itself", async () => {
  const calls = [];
  const queued = [];
  const rest = async (_schema, path, options) => {
    calls.push(path);
    if (path.startsWith("work_queue?")) return [];
    if (path.startsWith("agents?"))
      return [
        {
          id: "a-1",
          full_name: "Agent One",
          state: "WA",
          primary_postcode: "6000",
          website_url: "https://agent.example",
        },
      ];
    if (path.startsWith("agencies?")) return [];
    if (path.startsWith("source_documents?")) return [];
    if (path === "work_queue") {
      queued.push(JSON.parse(options.body));
      return [{ id: `job-${queued.length}` }];
    }
    throw new Error(`unexpected ${path}`);
  };
  const result = await handleAdRadarPageDiscovery(
    { id: "sweep-1", payload: { build_run_id: "sweep-1", entity_limit: 10 } },
    {
      rest,
      rawEvidenceDir: `/tmp/ad-radar-directory-sweep-test-${Date.now()}`,
      pageSize: 500,
    },
  );
  assert.equal(result.result.queued_entities, 1);
  assert.equal(queued[0].job_type, "blockwise-ad-directory-discovery-entity");
  assert.equal(
    calls.some((path) => path.startsWith("source_documents?")),
    false,
  );
});

test("completed roster checkpoints still return every saved row", async () => {
  const initial = await enumerateDirectoryPages({
    kinds: ["agent"],
    pageSize: 1,
    fetchPage: async (k, i, n) => pageRows(k, i, n),
  });
  const resumed = await enumerateDirectoryPages({
    kinds: ["agent"],
    pageSize: 1,
    checkpoint: initial.checkpoint,
    fetchPage: async () => {
      throw new Error("unexpected refetch");
    },
  });
  assert.equal(resumed.rows.length, 2);
});
test("vanity resolution rejects unrelated IDs and ambiguous owners", () => {
  assert.equal(
    facebookPageIdFromHtml(
      '{"__typename":"Page","userID":"123456","userVanity":"other"}',
      "acme",
    ),
    null,
  );
  assert.equal(
    facebookPageIdFromHtml(
      '{"__typename":"Page","userID":"123456","userVanity":"acme"}{"__typename":"Page","userID":"654321","userVanity":"acme"}',
      "acme",
    ),
    null,
  );
  assert.equal(facebookPageReference("123456").pageId, "123456");
  assert.equal(
    facebookPageReference("https://facebook.com/acme/posts/123456").pageId,
    null,
  );
});
test("directory fanout reaches beyond the first batch and stops at exhaustion", async () =>
  temp(async (root) => {
    const roster = Array.from({ length: 120 }, (_, i) => ({
      id: "a-" + String(i).padStart(3, "0"),
      full_name: "Agent " + i,
      state: "WA",
    }));
    const queue = [];
    const rest = async (_schema, path, options) => {
      if (path.startsWith("agents?")) return roster;
      if (path.startsWith("agencies?")) return [];
      if (path.startsWith("work_queue?")) {
        const match = decodeURIComponent(path).match(/dedupe_key=eq\.([^&]+)/);
        return queue.filter((row) => row.dedupe_key === match?.[1]);
      }
      if (path === "work_queue") {
        const row = { ...JSON.parse(options.body), id: "j-" + queue.length };
        queue.push(row);
        return [row];
      }
      throw new Error(path);
    };
    let job = {
      id: "root",
      payload: { build_run_id: "test-sweep", entity_limit: 50 },
    };
    let passes = 0;
    while (job) {
      await handleAdRadarPageDiscovery(job, { rest, rawEvidenceDir: root });
      passes++;
      job = queue.find(
        (row) =>
          row.job_type === "blockwise-ad-directory-discovery" && !row.ran,
      );
      if (job) job.ran = true;
      if (passes > 5) throw new Error("unbounded continuation");
    }
    const children = queue.filter((row) => row.job_type.endsWith("-entity"));
    assert.equal(passes, 3);
    assert.equal(children.length, 120);
    assert.equal(
      new Set(children.map((row) => row.payload.entity_id)).size,
      120,
    );
  }));
test("directory requests reject internal hosts and bounded redirect loops", async () => {
  assert.equal(isPublicDirectoryAddress("127.0.0.1"), false);
  assert.equal(isPublicDirectoryAddress("10.0.0.1"), false);
  assert.equal(isPublicDirectoryAddress("100.78.126.112"), false);
  assert.equal(isPublicDirectoryAddress("8.8.8.8"), true);
  let calls = 0;
  const fake = async () => {
    calls++;
    return { status: 302, headers: { get: () => "/loop" } };
  };
  await assert.rejects(
    () => boundedDirectoryFetch(fake, "https://[::1]", { retries: 0 }),
    /Unsafe/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => boundedDirectoryFetch(fake, "https://public.example", { retries: 0 }),
    /redirect limit/,
  );
  assert.equal(calls, 4);
});

test("structured person ownership is reusable but directory footer is never agency evidence", async () => {
  const { facebookOwnersFromHtml, linksForWebsiteEvidence } =
    await import("../hermes/tools/research-runtime/bin/ad-radar-directory-coverage.mjs");
  const body =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@graph": [
        {
          "@type": "Person",
          name: "Jane Smith",
          sameAs: ["https://facebook.com/123456"],
        },
        {
          "@type": "Organization",
          name: "REIWA",
          sameAs: ["https://facebook.com/999999"],
        },
      ],
    }) +
    "</script>";
  const evidence = {
    id: "doc",
    metadata: {
      facebook_owners: facebookOwnersFromHtml(body),
      official_facebook_links: ["https://facebook.com/999999"],
    },
  };
  const jane = linksForWebsiteEvidence(
    { id: "jane", kind: "agent", name: "Jane Smith" },
    "https://reiwa.com.au/jane/",
    evidence,
  );
  assert.equal(jane.length, 1);
  assert.equal(jane[0].pageId, "123456");
  assert.equal(jane[0].explicitAssignment, true);
  assert.deepEqual(
    linksForWebsiteEvidence(
      { id: "john", kind: "agent", name: "John Smith" },
      "https://reiwa.com.au/john/",
      evidence,
    ),
    [],
  );
  assert.deepEqual(
    linksForWebsiteEvidence(
      { id: "agency", kind: "agency", name: "Local Agency" },
      "https://reiwa.com.au/local-agency/",
      evidence,
    ),
    [],
  );
});

function discoveryRest({
  existingPages = [],
  pageLookup = [],
  sourceDocs = [],
} = {}) {
  const writes = [];
  return {
    writes,
    rest: async (_schema, path, options = {}) => {
      if (path.startsWith("source_documents?")) return sourceDocs;
      if (path === "source_documents") {
        writes.push({ path, body: JSON.parse(options.body) });
        return [{ id: "source-" + writes.length }];
      }
      if (path.startsWith("advertiser_pages?id=")) {
        writes.push({ path, body: JSON.parse(options.body) });
        return [
          {
            id: existingPages[0]?.id || "patched",
            ...existingPages[0],
            ...JSON.parse(options.body),
          },
        ];
      }
      if (
        path.startsWith("advertiser_pages?page_id=") ||
        (path.startsWith("advertiser_pages?select=id,page_id") &&
          !path.includes("page_url"))
      )
        return pageLookup;
      if (path.startsWith("advertiser_pages?select=")) return existingPages;
      if (path === "advertiser_pages") {
        writes.push(JSON.parse(options.body));
        return [{ id: `new-${writes.length}`, ...JSON.parse(options.body) }];
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

test("empty entity input invokes two qualified searches before a negative receipt", async () => {
  const queries = [];
  const { rest } = discoveryRest();
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "search-empty",
      payload: {
        entity_kind: "agency",
        entity_id: "g-empty",
        name: "No Match Agency",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      fetchImpl: async () => {
        throw new Error("no website should be fetched");
      },
      searchEvidence: async ({ query }) => {
        queries.push(query);
        return {
          complete: true,
          sourceDocumentId: `doc-${queries.length}`,
          sourceUrl: `https://search.test/${queries.length}`,
          results: [],
        };
      },
    },
  );
  assert.equal(queries.length, 2);
  assert.notEqual(queries[0], queries[1]);
  assert.equal(result.result.search_outcome, "searched_not_found");
  assert.equal(
    result.result.discovery_receipt.evidence.searchReceipts.length,
    2,
  );
});

test("blocked or malformed search remains unresolved, never a negative absence", async () => {
  const { rest } = discoveryRest();
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "search-blocked",
      payload: {
        entity_kind: "agent",
        entity_id: "a-blocked",
        name: "Blocked Agent",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      fetchImpl: async () => {
        throw new Error("no website should be fetched");
      },
      searchEvidence: async () => ({
        complete: false,
        sourceDocumentId: null,
        sourceUrl: "https://search.test/blocked",
        results: [],
        error: "provider_blocked",
      }),
    },
  );
  assert.equal(result.result.search_outcome, "unresolved");
  assert.notEqual(result.result.search_outcome, "searched_not_found");
});

test("two complete negative searches retain their receipts and use the explicit negative label", async () => {
  const { rest } = discoveryRest();
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "search-negative",
      payload: {
        entity_kind: "agency",
        entity_id: "g-negative",
        name: "Negative Agency",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      fetchImpl: async () => {
        throw new Error("no website should be fetched");
      },
      searchEvidence: async ({ query }) => ({
        complete: true,
        sourceDocumentId: query.includes("Western") ? "doc-2" : "doc-1",
        sourceUrl: `https://search.test/${query.includes("Western") ? 2 : 1}`,
        results: [
          {
            url: "https://example.com/unrelated",
            title: "Unrelated result",
            description: "No match",
          },
        ],
      }),
    },
  );
  assert.equal(result.result.search_outcome, "searched_not_found");
  assert.equal(result.result.reason, "search_completed_no_matching_page_found");
  assert.equal(
    result.result.discovery_receipt.evidence.searchReceipts.length,
    2,
  );
});

test("existing Facebook URL is reused without paid search or duplicate registration", async () => {
  let searches = 0;
  const { rest, writes } = discoveryRest({
    existingPages: [
      {
        id: "page-existing",
        page_id: "123456",
        page_url: "https://facebook.com/acme-real-estate",
        page_vanity: "corrupt-vanity",
        agent_id: "a-existing",
        agency_id: null,
        status: "resolved",
        scan_enabled: true,
      },
    ],
  });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "reuse",
      payload: {
        entity_kind: "agent",
        entity_id: "a-existing",
        name: "Acme Agent",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      fetchImpl: async () => {
        throw new Error("existing URL should avoid fetch");
      },
      searchEvidence: async () => {
        searches += 1;
        throw new Error("existing URL should avoid search");
      },
    },
  );
  assert.equal(searches, 0);
  assert.equal(writes.length, 0);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(
    result.result.discovery_receipt.evidence.links[0].url,
    "https://www.facebook.com/acme-real-estate",
  );
});

test("known numeric page with an original URL avoids search even when vanity is corrupt", async () => {
  let searches = 0;
  const { rest } = discoveryRest({
    existingPages: [
      {
        id: "page-known",
        page_id: "7654321",
        page_url: "https://www.facebook.com/pages/Brand/7654321",
        page_vanity: "not-the-page",
        agency_id: "g-known",
        agent_id: null,
        status: "resolved_collectable",
        scan_enabled: true,
      },
    ],
  });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "known",
      payload: {
        entity_kind: "agency",
        entity_id: "g-known",
        name: "Known Agency",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      fetchImpl: async () => {
        throw new Error("known URL should avoid fetch");
      },
      searchEvidence: async () => {
        searches += 1;
        throw new Error("known URL should avoid search");
      },
    },
  );
  assert.equal(searches, 0);
  assert.equal(result.result.search_outcome, "resolved");
});

test("duplicate saved URL prefers the known numeric row and does no replacement discovery", async () => {
  let fetches = 0,
    searches = 0;
  const url = "https://facebook.com/realestate88.perth";
  const { rest, writes } = discoveryRest({
    existingPages: [
      {
        id: "page-unresolved",
        page_id: null,
        page_url: url,
        page_vanity: "realestate88.perth",
        agency_id: "agency-dup",
        agent_id: null,
        owner_type: "agency",
        status: "verified_real_estate_unresolved",
        scan_enabled: false,
        scan_state: "paused",
        metadata: { scan_disabled_reason: "unresolved_slug_page_id" },
      },
      {
        id: "page-known",
        page_id: "100057151129082",
        page_url: url,
        page_vanity: "realestate88.perth",
        agency_id: "agency-dup",
        agent_id: null,
        owner_type: "agency",
        status: "resolved_collectable",
        scan_enabled: true,
        scan_state: "needs_first_fill",
      },
    ],
  });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "duplicate-url",
      payload: {
        entity_kind: "agency",
        entity_id: "agency-dup",
        name: "Realestate 88",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-duplicate-url",
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("known saved page should avoid website crawl");
      },
      searchEvidence: async () => {
        searches += 1;
        throw new Error("known saved page should avoid paid search");
      },
    },
  );
  assert.equal(fetches, 0);
  assert.equal(searches, 0);
  assert.equal(writes.length, 0);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(result.result.evidence.links[0].pageId, "100057151129082");
});

test("resolving an existing vanity URL reconciles its row without creating a duplicate", async () => {
  let searches = 0;
  const existing = {
    id: "page-vanity",
    page_id: null,
    page_url: "https://facebook.com/acme",
    page_vanity: "corrupt",
    agent_id: "a-vanity",
    agency_id: null,
    status: "unresolved",
    scan_enabled: false,
  };
  const { rest, writes } = discoveryRest({
    existingPages: [existing],
    pageLookup: [],
  });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "vanity",
      payload: {
        entity_kind: "agent",
        entity_id: "a-vanity",
        name: "Acme Agent",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-directory-receipt-test",
      searchEvidence: async () => {
        searches += 1;
        throw new Error("saved URL should avoid search");
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
      }),
    },
  );
  assert.equal(searches, 0);
  assert.equal(
    writes.filter((row) => row.path?.startsWith("advertiser_pages?id=")).length,
    1,
  );
  assert.equal(
    writes.filter((row) => row.path === "advertiser_pages").length,
    0,
  );
  assert.equal(result.result.search_outcome, "page_found");
});

test("WA coverage fanout includes every agent and agency in the authoritative roster", async () => {
  const queued = [];
  const rest = async (_schema, path, options = {}) => {
    if (path.startsWith("agents?"))
      return [
        { id: "a-wa-1", full_name: "WA Agent One", state: "WA" },
        { id: "a-wa-2", full_name: "WA Agent Two", state: "WA" },
      ];
    if (path.startsWith("agencies?"))
      return [
        { id: "g-wa-1", name: "WA Agency One", state: "WA" },
        { id: "g-wa-2", name: "WA Agency Two", state: "WA" },
      ];
    if (path.startsWith("work_queue?")) return [];
    if (path === "work_queue") {
      const body = JSON.parse(options.body);
      queued.push(body);
      return [{ id: `job-${queued.length}` }];
    }
    throw new Error(`unexpected ${path}`);
  };
  const result = await handleAdRadarPageDiscovery(
    { id: "all-wa", payload: { build_run_id: "all-wa-v2", entity_limit: 50 } },
    { rest, rawEvidenceDir: `/tmp/ad-radar-all-wa-${Date.now()}` },
  );
  assert.equal(result.result.enumerated_entities, 4);
  assert.equal(result.result.queued_entities, 4);
  assert.deepEqual(
    new Set(
      queued.map(
        (row) => `${row.payload.entity_kind}:${row.payload.entity_id}`,
      ),
    ),
    new Set(["agent:a-wa-1", "agent:a-wa-2", "agency:g-wa-1", "agency:g-wa-2"]),
  );
});

test("agency-first website evidence is fetched once and named profiles do not inherit the footer", async () => {
  const docs = [],
    pages = [],
    fetches = [];
  const responses = {
    "https://agency.example/":
      '{"url":"\\/team/jane-smith","title":"Meet The Team","label":"Our team at Agency One"}{"url":"\\/staff/tony-choong","title":"Tony Choong"}<a href="https://facebook.com/Agency-Footer/">Facebook</a>',
    "https://agency.example/team/jane-smith":
      '<h1>Jane Smith</h1><nav><a href="https://facebook.com/agency-footer">Facebook</a></nav><a href="https://facebook.com/jane-smith">Jane Facebook</a>',
    "https://agency.example/staff/tony-choong":
      '<h1>Tony Choong</h1><footer><a href="https://www.facebook.com/agency-footer/">Agency Facebook</a></footer>',
    "https://www.facebook.com/jane-smith":
      '{"__typename":"Page","userID":"123456","userVanity":"jane-smith"}',
  };
  const rest = async (_schema, path, options = {}) => {
    if (path.startsWith("source_documents?")) return docs;
    if (path.includes("agent_id=eq.")) {
      const agentId = decodeURIComponent(
        path.split("agent_id=eq.")[1].split("&")[0],
      );
      return pages.filter((row) => row.agent_id === agentId);
    }
    if (path === "source_documents") {
      const body = JSON.parse(options.body),
        row = {
          id: "doc-" + (docs.length + 1),
          ...body,
          fetched_at: body.metadata?.fetched_at,
        };
      docs.push(row);
      return [row];
    }
    if (path.startsWith("advertiser_pages?select="))
      return pages.filter((row) => row.page_id);
    if (path === "advertiser_pages") {
      const row = {
        id: "page-" + (pages.length + 1),
        ...JSON.parse(options.body),
      };
      pages.push(row);
      return [row];
    }
    throw new Error("unexpected " + path);
  };
  const fetchImpl = async (url) => {
    fetches.push(url);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const body = responses[url];
    if (!body)
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => "",
      };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => body,
    };
  };
  const base = {
    state: "WA",
    agency_id: "agency-1",
    agency_name: "Agency One",
    agency_website_url: "https://agency.example/",
    fetchImpl,
    rawEvidenceDir: "/tmp/ad-radar-agency-share-" + Date.now(),
    now: () => "2026-09-08T00:00:00.000Z",
  };
  const [jane, john, tony] = await Promise.all([
    handleAdRadarEntityDiscovery(
      {
        id: "job-jane",
        payload: {
          entity_kind: "agent",
          entity_id: "agent-jane",
          name: "Jane Smith",
          ...base,
        },
      },
      { rest, ...base },
    ),
    handleAdRadarEntityDiscovery(
      {
        id: "job-john",
        payload: {
          entity_kind: "agent",
          entity_id: "agent-john",
          name: "John Smith",
          ...base,
        },
      },
      { rest, ...base },
    ),
    handleAdRadarEntityDiscovery(
      {
        id: "job-tony",
        payload: {
          entity_kind: "agent",
          entity_id: "agent-tony",
          name: "Tony Choong",
          ...base,
        },
      },
      { rest, ...base },
    ),
  ]);
  assert.equal(
    fetches.filter((url) => url === "https://agency.example/").length,
    1,
  );
  assert.equal(
    fetches.filter((url) => url === "https://agency.example/team/jane-smith")
      .length,
    1,
  );
  assert.equal(
    fetches.filter((url) => url === "https://agency.example/staff/tony-choong")
      .length,
    1,
  );
  assert.equal(pages.length, 1);
  assert.equal(pages[0].agent_id, "agent-jane");
  assert.equal(jane.result.search_outcome, "resolved");
  assert.notEqual(john.result.search_outcome, "resolved");
  assert.notEqual(tony.result.search_outcome, "resolved");
  assert.equal(
    tony.result.evidence.links.some((link) =>
      link.url.toLowerCase().includes("agency-footer"),
    ),
    false,
  );
  assert.equal(
    tony.result.evidence.links.some(
      (link) => link.sourceType === "named_agent_profile",
    ),
    false,
  );
  assert.equal(
    john.result.evidence.links.some((link) =>
      link.url.includes("agency-footer"),
    ),
    false,
  );
  const beforeReplay = fetches.length;
  const replay = await handleAdRadarEntityDiscovery(
    {
      id: "job-jane-replay",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-jane",
        name: "Jane Smith",
        ...base,
      },
    },
    { rest, ...base },
  );
  assert.equal(fetches.length, beforeReplay);
  assert.equal(replay.result.search_outcome, "resolved");
});

test("optional exact identity resolver requires numeric proof and keeps the original saved URL", async () => {
  const seen = [];
  const saved = {
    id: "legacy-doc",
    source_url: "https://directory.example/jane",
    metadata: {
      agent_id: "agent-identity",
      official_facebook_links: ["https://facebook.com/jane-smith"],
    },
  };
  const { rest, writes } = discoveryRest({ sourceDocs: [saved] });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "identity-job",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-identity",
        name: "Jane Smith",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-identity-resolver",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: async () => "",
      }),
      resolvePageEvidence: async (input) => {
        seen.push(input);
        return {
          pageId: "123456",
          permalinkMatch: true,
          pageUrl: input.exactUrl,
          sourceDocumentId: "resolved-doc",
        };
      },
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].exactUrl, "https://www.facebook.com/jane-smith");
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(
    writes.find((row) => row.page_id === "123456").page_url,
    "https://www.facebook.com/jane-smith",
  );
});

test("saved external agency site wins over a directory URL without fetching the directory", async () => {
  const fetched = [];
  const saved = {
    id: "agency-site",
    source: "agency_website",
    source_url: "https://agency.example/",
    fetched_at: "2026-08-01T00:00:00.000Z",
    metadata: {
      agency_id: "agency-saved",
      agency_identity_confirmed: true,
      agency_identity_name: "saved agency",
      website_url: "https://agency.example/",
    },
  };
  const { rest, writes } = discoveryRest({ sourceDocs: [saved] });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "agency-site-job",
      payload: {
        entity_kind: "agency",
        entity_id: "agency-saved",
        name: "Saved Agency",
        state: "WA",
        website_url: "https://reiwa.com.au/agency/saved",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-saved-agency-site",
      fetchImpl: async (url) => {
        fetched.push(url);
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            '<h1>Saved Agency</h1><a href="https://facebook.com/pages/saved/123456">Facebook</a>',
        };
      },
      now: () => "2026-09-08T00:00:00.000Z",
    },
  );
  assert.deepEqual(fetched, ["https://agency.example/"]);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(
    writes.find((row) => row.page_id === "123456").page_url,
    "https://www.facebook.com/123456",
  );
});

test("official search-site results get one bounded free inspection before any handoff", async () => {
  const fetched = [],
    searches = [];
  const fixture = discoveryRest();
  const { writes } = fixture;
  let storedSource = false;
  const rest = async (schema, path, options = {}) => {
    if (path === "source_documents") {
      storedSource = true;
      return [{ id: "official-site-doc" }];
    }
    return fixture.rest(schema, path, options);
  };
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "official-search-site",
      payload: {
        entity_kind: "agency",
        entity_id: "agency-search",
        name: "Safe Agency",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-official-search-site",
      fetchImpl: async (url) => {
        fetched.push(url);
        if (url === "https://safe-agency.example/")
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () =>
              '<h1>Safe Agency</h1><address>Perth WA 6000</address><a href="https://facebook.com/safe-agency">Facebook</a>',
          };
        if (url === "https://www.facebook.com/safe-agency")
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () =>
              '{"__typename":"Page","userID":"7654321","userVanity":"safe-agency"}',
          };
        throw new Error("unexpected fetch " + url);
      },
      searchEvidence: async ({ query }) => {
        searches.push(query);
        return {
          complete: true,
          sourceDocumentId: "search-" + searches.length,
          sourceUrl: "https://search.example/" + searches.length,
          results:
            searches.length === 1
              ? [
                  {
                    url: "https://safe-agency.example/",
                    title: "Safe Agency",
                    description: "Safe Agency real estate WA",
                  },
                ]
              : [],
        };
      },
    },
  );
  assert.equal(searches.length, 1);
  assert.deepEqual(fetched, [
    "https://safe-agency.example/",
    "https://www.facebook.com/safe-agency",
  ]);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(result.result.evidence.links[0].pageId, "7654321");
  assert.equal(storedSource, true);
});

test("any saved owned unresolved Facebook reference skips shared agency crawl", async () => {
  const fetched = [];
  const existing = {
    id: "page-unresolved-owned",
    page_id: null,
    page_url: "https://facebook.com/olivia-agent",
    page_vanity: "olivia-agent",
    agent_id: "agent-owned",
    agency_id: null,
    owner_type: "agent",
    status: "verified_real_estate_unresolved",
    scan_enabled: false,
    scan_state: "paused",
    metadata: { scan_disabled_reason: "unresolved_slug_page_id" },
  };
  const { rest } = discoveryRest({ existingPages: [existing] });
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "saved-ref-skip",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-owned",
        name: "Olivia Agent",
        state: "WA",
        agency_id: "agency-owned",
        agency_name: "Owned Agency",
        agency_website_url: "https://owned-agency.example/",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-saved-ref-skip",
      fetchImpl: async (url) => {
        fetched.push(url);
        return {
          ok: false,
          status: 403,
          headers: { get: () => null },
          text: async () => "",
        };
      },
      searchEvidence: async () => {
        throw new Error("saved reference should avoid search");
      },
    },
  );
  assert.deepEqual(fetched, ["https://www.facebook.com/olivia-agent"]);
  assert.equal(result.result.search_outcome, "page_found");
});

test("generic Facebook user IDs are not page proof", () => {
  assert.equal(
    facebookPageIdFromHtml('{"userID":"123456","userVanity":"acme"}', "acme"),
    null,
  );
});

test("automatic unresolved-slug pause is reactivated only after strict identity proof", async () => {
  const existing = {
    id: "page-auto-paused",
    page_id: null,
    page_url: "https://facebook.com/jane-smith",
    agent_id: "agent-auto",
    agency_id: null,
    status: "verified_real_estate_unresolved",
    scan_enabled: false,
    scan_state: "paused",
    metadata: { scan_disabled_reason: "unresolved_slug_page_id" },
  };
  const fixture = discoveryRest({ existingPages: [existing] });
  const paths = [];
  const rest = async (schema, path, options) => {
    paths.push(path);
    return fixture.rest(schema, path, options);
  };
  const { writes } = fixture;
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "auto-pause-job",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-auto",
        name: "Jane Smith",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-auto-reactivation",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: async () => "",
      }),
      resolvePageEvidence: async ({ exactUrl }) => ({
        pageId: "123456",
        permalinkMatch: true,
        pageUrl: exactUrl,
        sourceDocumentId: "strict-doc",
      }),
    },
  );
  const patch = writes.find((row) =>
    row.path?.startsWith("advertiser_pages?id="),
  );
  const existingSelect = paths.find((path) =>
    path.startsWith("advertiser_pages?select="),
  );
  assert.match(existingSelect, /scan_state/u);
  assert.match(existingSelect, /metadata/u);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(patch.body.page_id, "123456");
  assert.equal(patch.body.status, "resolved_collectable");
  assert.equal(patch.body.scan_enabled, true);
  assert.equal(patch.body.scan_state, "needs_first_fill");
  assert.equal(
    patch.body.metadata.scan_reactivation_reason,
    "strict_facebook_page_identity",
  );
});

test("same-name out-of-state search result cannot assign Facebook ownership", async () => {
  const fetched = [],
    searches = [];
  const fixture = discoveryRest();
  const { writes } = fixture;
  let storedSource = false;
  const rest = async (schema, path, options = {}) => {
    if (path === "source_documents") {
      storedSource = true;
      return [{ id: "official-site-doc" }];
    }
    return fixture.rest(schema, path, options);
  };
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "official-search-site",
      payload: {
        entity_kind: "agency",
        entity_id: "agency-search",
        name: "Safe Agency",
        state: "WA",
      },
    },
    {
      rest,
      rawEvidenceDir: "/tmp/ad-radar-official-search-site",
      fetchImpl: async (url) => {
        fetched.push(url);
        if (url === "https://safe-agency.example/")
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () =>
              '<h1>Safe Agency</h1><address>Sydney NSW 2000</address><a href="https://facebook.com/safe-agency">Facebook</a>',
          };
        if (url === "https://www.facebook.com/safe-agency")
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () =>
              '{"__typename":"Page","userID":"7654321","userVanity":"safe-agency"}',
          };
        throw new Error("unexpected fetch " + url);
      },
      searchEvidence: async ({ query }) => {
        searches.push(query);
        return {
          complete: true,
          sourceDocumentId: "search-" + searches.length,
          sourceUrl: "https://search.example/" + searches.length,
          results:
            searches.length === 1
              ? [
                  {
                    url: "https://safe-agency.example/",
                    title: "Safe Agency",
                    description: "Safe Agency real estate WA",
                  },
                ]
              : [],
        };
      },
    },
  );
  assert.equal(searches.length, 1);
  assert.deepEqual(fetched, ["https://safe-agency.example/"]);
  assert.equal(result.result.search_outcome, "unresolved");
  assert.equal(result.result.evidence.links.length, 0);
  assert.equal(storedSource, false);
});

test("cached pre-repair named-profile metadata cannot reuse a shared agency footer as a personal page", async () => {
  const now = () => "2026-09-08T12:00:00.000Z";
  const sourceDocs = [
    {
      id: "cached-home",
      source: "ad_radar_agency_website",
      source_url: "https://agency.example/",
      fetched_at: now(),
      metadata: {
        agency_id: "cached-agency",
        crawl_role: "agency_homepage",
        official_facebook_links: ["https://facebook.com/Agency-Footer"],
      },
    },
    {
      id: "cached-tony",
      source: "ad_radar_agency_website",
      source_url: "https://agency.example/staff/tony-choong",
      fetched_at: now(),
      metadata: {
        agency_id: "cached-agency",
        crawl_role: "agency_profile",
        crawl_parent_url: "https://agency.example/",
        profile_names: ["Tony Choong"],
        named_profile_facebook_links: [
          "https://www.facebook.com/agency-footer/",
        ],
        official_facebook_links: ["https://www.facebook.com/agency-footer/"],
      },
    },
  ];
  const { rest, writes } = discoveryRest({ sourceDocs });
  let searches = 0;
  const r = await handleAdRadarEntityDiscovery(
    {
      id: "cached-footer-job",
      payload: {
        entity_kind: "agent",
        entity_id: "cached-tony",
        name: "Tony Choong",
        state: "WA",
        agency_id: "cached-agency",
        agency_name: "Cached Agency",
        agency_website_url: "https://agency.example/",
      },
    },
    {
      rest,
      now,
      rawEvidenceDir: "/tmp/ad-radar-cached-footer",
      fetchImpl: async () => {
        throw new Error("cached evidence must not fetch a page");
      },
      resolvePageEvidence: async () => {
        throw new Error("must not pay for agency footer");
      },
      searchEvidence: async () => {
        searches++;
        return {
          complete: true,
          actualAttempted: true,
          sourceDocumentId: "mock-search-" + searches,
          sourceUrl: "https://search.example/" + searches,
          results: [],
        };
      },
    },
  );
  assert.equal(searches, 2);
  assert.deepEqual(r.result.evidence.links, []);
  assert.equal(writes.length, 0);
  assert.equal(r.result.search_outcome, "searched_not_found");
});

test("numeric Facebook search candidate resolves only with an independent agent backlink", async () => {
  const sourceDocs = [
    {
      id: "agent-backlink",
      source: "facebook_page_identity",
      source_url: "https://jane.example/team/jane-smith",
      metadata: {
        agent_id: "agent-search-positive",
        agency_id: "agency-search-positive",
        profile_names: ["Jane Smith"],
        facebook_owners: [
          {
            kind: "agent",
            name: "Jane Smith",
            urls: ["https://www.facebook.com/pages/jane-smith/123456"],
          },
        ],
      },
    },
  ];
  const fixture = discoveryRest({ sourceDocs });
  let searches = 0;
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "search-positive-job",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-search-positive",
        name: "Jane Smith",
        state: "WA",
        agency_id: "agency-search-positive",
        agency_name: "Positive Agency",
      },
    },
    {
      rest: fixture.rest,
      rawEvidenceDir: "/tmp/ad-radar-search-positive",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "<title>Jane Smith | Facebook</title>",
      }),
      searchEvidence: async () => {
        searches += 1;
        return {
          complete: true,
          sourceDocumentId: "search-positive",
          sourceUrl: "https://google.example/search",
          results: [
            {
              url: "https://www.facebook.com/pages/jane-smith/123456",
              title: "Jane Smith",
              description: "Jane Smith Positive Agency WA",
            },
          ],
        };
      },
    },
  );
  assert.equal(searches, 1);
  assert.equal(result.result.search_outcome, "resolved");
  assert.equal(result.result.evidence.links[0].pageId, "123456");
  assert.equal(
    result.result.evidence.links[0].sourceType,
    "verified_official_backlink",
  );
});

test("numeric same-name Facebook search candidate is rejected without target ownership proof", async () => {
  const sourceDocs = [
    {
      id: "shared-agency-profile",
      source: "ad_radar_agency_website",
      source_url: "https://agency.example/team/other-jane",
      metadata: {
        agency_id: "agency-shared",
        crawl_role: "agency_profile",
      },
    },
  ];
  const fixture = discoveryRest({ sourceDocs });
  let searches = 0;
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "search-negative-job",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-search-negative",
        name: "Jane Smith",
        state: "WA",
        agency_id: "agency-shared",
        agency_name: "Shared Agency",
      },
    },
    {
      rest: fixture.rest,
      rawEvidenceDir: "/tmp/ad-radar-search-negative",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "<title>Jane Smith | Facebook</title>",
      }),
      searchEvidence: async () => {
        searches += 1;
        return {
          complete: true,
          sourceDocumentId: "search-negative",
          sourceUrl: "https://google.example/search",
          results: [
            {
              url: "https://www.facebook.com/pages/jane-smith/123456",
              title: "Jane Smith",
              description: "Jane Smith Shared Agency WA",
            },
          ],
        };
      },
    },
  );
  assert.equal(searches, 1);
  assert.equal(result.result.search_outcome, "page_found");
  assert.deepEqual(result.result.evidence.links, []);
  assert.match(result.result.errors[0].reason, /ownership_unproven/u);
  assert.equal(fixture.writes.length, 0);
});

test("cached app-store and social agency sources are not usable homepage evidence", async () => {
  const sourceDocs = [
    {
      id: "bad-appstore-home",
      source: "ad_radar_agency_website",
      source_url: "https://itunes.apple.com/au/app/id1417769562",
      fetched_at: "2026-09-08T00:00:00.000Z",
      metadata: {
        agency_id: "agency-appstore",
        entity_kind: "agency",
        entity_id: "agency-appstore",
        subject_kind: "agency",
        subject_id: "agency-appstore",
        crawl_role: "agency_homepage",
        official_facebook_links: ["https://www.facebook.com/appstore/"],
        facebook_owners: [
          {
            kind: "agency",
            name: "App Store",
            urls: ["https://www.facebook.com/appstore/"],
          },
        ],
      },
    },
  ];
  const fixture = discoveryRest({ sourceDocs });
  let fetched = 0;
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "appstore-job",
      payload: {
        entity_kind: "agency",
        entity_id: "agency-appstore",
        name: "Fremantle Co",
        state: "WA",
        website_url: "https://reiwa.com.au/real-estate-agency/fremantle-co/",
      },
    },
    {
      rest: fixture.rest,
      rawEvidenceDir: "/tmp/ad-radar-appstore",
      fetchImpl: async () => {
        fetched += 1;
        throw new Error("blocked source must not fetch");
      },
      searchEvidence: async () => ({
        complete: true,
        sourceDocumentId: "appstore-search",
        sourceUrl: "https://google.example/search",
        results: [],
      }),
    },
  );
  assert.equal(fetched, 0);
  assert.equal(result.result.evidence.links.length, 0);
  assert.notEqual(result.result.search_outcome, "resolved");
});

test("Google adapter replay verifies a candidate with free Facebook public proof", async () => {
  const fixture = discoveryRest();
  let searches = 0,
    facebookFetches = 0;
  const result = await handleAdRadarEntityDiscovery(
    {
      id: "replay-job",
      payload: {
        entity_kind: "agent",
        entity_id: "agent-replay",
        name: "Jane Smith",
        state: "WA",
        agency_id: "agency-replay",
        agency_name: "Replay Agency",
        agency_primary_suburb: "Perth",
      },
    },
    {
      rest: fixture.rest,
      rawEvidenceDir: "/tmp/ad-radar-search-replay",
      fetchImpl: async () => {
        facebookFetches += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            "<title>Jane Smith | Replay Agency Perth WA</title>",
        };
      },
      searchEvidence: async () => {
        searches += 1;
        return {
          complete: true,
          actualAttempted: false,
          sourceDocumentId: "adapter-replay",
          sourceUrl: "https://google.example/replay",
          results: [
            {
              url: "https://www.facebook.com/pages/jane-smith/123456",
              title: "Jane Smith",
              description: "untrusted lead text",
            },
          ],
        };
      },
    },
  );
  assert.equal(searches, 1);
  assert.equal(facebookFetches, 1);
  assert.equal(result.result.search_outcome, "resolved");
  assert.match(result.result.evidence.links[0].sourceDocumentId, /^source-/u);
  assert.equal(
    fixture.writes.find((row) => row.path === "source_documents").body.metadata
      .owner_proof,
    "public_local_or_domain",
  );
  assert.equal(
    result.result.evidence.searchReceipts[0].reason,
    "search_completed",
  );
});

test("authoritative suburb permits only one matching public WA title marker", async () => {
  const run = async (markers, websiteUrl = null) => {
    const fixture = discoveryRest();
    return handleAdRadarEntityDiscovery(
      {
        id: "inside-realty-marker",
        payload: {
          entity_kind: "agency",
          entity_id: "inside-realty",
          name: "Inside Realty",
          state: "WA",
          primary_suburb: "Applecross",
          website_url: websiteUrl,
        },
      },
      {
        rest: fixture.rest,
        rawEvidenceDir: "/tmp/ad-radar-inside-realty",
        fetchImpl: async (url) => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () =>
            String(url).includes("agency.example")
              ? "<title>Official agency site</title>"
              : markers +
                '{"__typename":"Page","id":"100063518318943","url":"https://www.facebook.com/insiderealtyapplecross"}',
        }),
        searchEvidence: async () => ({
          complete: true,
          actualAttempted: false,
          sourceDocumentId: "adapter-inside-realty",
          sourceUrl: "https://google.example/inside",
          results: [
            {
              url: "https://www.facebook.com/100063518318943",
              title: "Inside Realty",
              description: "untrusted search lead",
            },
          ],
        }),
      },
    );
  };
  const positive = await run(
    '<title>Inside Realty | Applecross WA</title><meta property="og:title" content="Inside Realty | Applecross WA">',
  );
  assert.equal(positive.result.search_outcome, "resolved");
  assert.equal(positive.result.evidence.links[0].pageId, "100063518318943");

  for (const markers of [
    "<title>Inside Realty | Cottesloe WA</title>",
    "<title>Inside Realty WA</title>",
    '<title>Inside Realty | Applecross WA</title><meta property="og:title" content="Inside Realty | Cottesloe WA">',
    '<title>Inside Realty</title><meta property="og:title" content="Other Realty | Applecross WA">',
  ]) {
    const rejected = await run(markers);
    assert.equal(rejected.result.search_outcome, "page_found");
    assert.deepEqual(rejected.result.evidence.links, []);
  }

  const lookalikeHost = await run(
    "<title>Inside Realty</title>https://agency.example.evil.com",
    "https://agency.example",
  );
  assert.equal(lookalikeHost.result.search_outcome, "page_found");
  assert.deepEqual(lookalikeHost.result.evidence.links, []);
});
