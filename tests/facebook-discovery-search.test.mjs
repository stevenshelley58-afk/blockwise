import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFacebookSearchEvidence,
  parseGoogleSearchResponse,
} from "../hermes/tools/research-runtime/bin/facebook-discovery-search.mjs";

const RUN_IDS = [
  "11111111-1111-5111-8111-111111111111",
  "33333333-3333-5333-8333-333333333333",
  "55555555-5555-5555-8555-555555555555",
];
const SOURCE_ID = "22222222-2222-5222-8222-222222222222";

function response(
  status,
  body,
  headers = { "spb-cost": "10", "spb-request-id": "req-1" },
) {
  const values = new Map(Object.entries(headers));
  return {
    status,
    headers: { get: (key) => values.get(key) ?? null },
    text: async () => body,
  };
}

function harness(root, options = {}) {
  const runs = new Map();
  const runRows = new Map();
  const attempts = new Map();
  const events = [];
  const settleCalls = [];
  const fetchCalls = [];
  const sourceCalls = [];
  let nextRun = 0;
  let sourceFailures = options.sourceFailures || 0;

  const rest = async (_schema, path, request = {}) => {
    if (request.method === "POST" && path === "ad_fetch_runs") {
      const row = JSON.parse(request.body);
      let id = runs.get(row.idempotency_key);
      if (!id) {
        id =
          RUN_IDS[nextRun++] ||
          "77777777-7777-5777-8777-" + String(nextRun).padStart(12, "0");
        runs.set(row.idempotency_key, id);
        runRows.set(id, { id, ...row });
      }
      return [{ id }];
    }
    if (request.method === "PATCH" && path.startsWith("ad_fetch_runs?id=eq.")) {
      const id = decodeURIComponent(path.slice("ad_fetch_runs?id=eq.".length));
      const patch = JSON.parse(request.body);
      const current = runRows.get(id);
      if (!current) return [];
      runRows.set(id, { ...current, ...patch });
      events.push({ type: "run_patch", id, patch });
      return [{ id, ...runRows.get(id) }];
    }
    if (path.startsWith("provider_credit_attempts?")) {
      const id = decodeURIComponent(
        path.match(/attempt_id=eq\.([^&]+)/)?.[1] || "",
      );
      const attempt = attempts.get(id);
      return attempt ? [{ ...attempt }] : [];
    }
    if (request.method === "POST" && path === "ad_fetch_attempts") {
      const row = JSON.parse(request.body);
      attempts.set(row.provider_credit_attempt_id, {
        attempt_id: row.provider_credit_attempt_id,
        provider: row.provider,
        run_id: row.ad_fetch_run_id,
        status: "reserved",
        outcome: null,
        charge_known: null,
        actual_credits: null,
        reserved_credits: 10,
        run_credit_cap: 10,
      });
      events.push({ type: "attempt_post", row });
      return [{ provider_credit_attempt_id: row.provider_credit_attempt_id }];
    }
    if (
      request.method === "PATCH" &&
      path.startsWith("ad_fetch_attempts?provider_credit_attempt_id=eq.")
    ) {
      events.push({ type: "attempt_patch", patch: JSON.parse(request.body) });
      return [{ id: "attempt-row" }];
    }
    if (path.startsWith("ad_fetch_attempts?select=")) {
      events.push({ type: "attempt_history", path });
      return options.attemptHistory || [];
    }
    throw new Error(
      "unexpected REST call: " + (request.method || "GET") + " " + path,
    );
  };

  const rpc = async (name, payload) => {
    events.push({ type: "rpc", name, payload });
    if (name === "reserve_provider_attempt_credits") {
      attempts.set(payload.p_attempt_id, {
        attempt_id: payload.p_attempt_id,
        provider: "scrapingbee",
        run_id: payload.p_run_id,
        status: "reserved",
        outcome: null,
        charge_known: null,
        actual_credits: null,
        reserved_credits: payload.p_reserved_credits,
        run_credit_cap: payload.p_run_credit_cap,
      });
      return { status: "reserved" };
    }
    if (name === "settle_provider_attempt_credits") {
      settleCalls.push(payload);
      const attempt = attempts.get(payload.p_attempt_id);
      if (attempt)
        Object.assign(attempt, {
          status: "settled",
          outcome: payload.p_outcome,
          charge_known: payload.p_charge_known,
          actual_credits: payload.p_actual_credits,
        });
      return { status: "settled" };
    }
    throw new Error("unexpected RPC " + name);
  };

  const sourceDocument = async (...args) => {
    sourceCalls.push(args);
    if (sourceFailures > 0) {
      sourceFailures -= 1;
      throw new Error(
        "source write failed for secret search " + (options.querySecret || ""),
      );
    }
    return SOURCE_ID;
  };

  const fn = createFacebookSearchEvidence({
    rest,
    rpc,
    apiKey: options.apiKey ?? "secret-key",
    enabled: options.enabled ?? true,
    balanceEvidence:
      options.balanceEvidence ||
      (async () => ({ remaining: 50, verifiedAt: "2026-09-08T00:00:00.000Z" })),
    recordAttempt: async (row) => {
      events.push({ type: "record_attempt", row });
      return row;
    },
    patchAttempt: async (id, patch) =>
      events.push({ type: "patch_attempt", id, patch }),
    sourceDocument,
    rawEvidenceDir: root,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (options.fetchError) throw options.fetchError;
      const index = fetchCalls.length - 1;
      const item = Array.isArray(options.responses)
        ? options.responses[index]
        : options.responses;
      return item || response(200, JSON.stringify({ organic_results: [] }));
    },
    now: () => "2026-09-08T00:00:01.000Z",
  });
  return {
    fn,
    runs,
    runRows,
    attempts,
    events,
    settleCalls,
    fetchCalls,
    sourceCalls,
  };
}

async function withHarness(options, callback) {
  const root = await mkdtemp(join(tmpdir(), "fb-search-"));
  try {
    return await callback(harness(root, options), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("parses documented organic results, query echo, and zero-results flag", () => {
  const parsed = parseGoogleSearchResponse(
    JSON.stringify({
      meta_data: { url: "https://www.google.com/search?q=Olivia%20Porteous" },
      organic_results: [
        { link: "https://facebook.com/x", title: "X", snippet: "Y" },
      ],
      zero_results_for_original_query: false,
    }),
    "Olivia Porteous",
  );
  assert.equal(parsed.results[0].url, "https://facebook.com/x");
  assert.equal(parsed.zeroResultsForOriginalQuery, false);
  assert.equal(
    parseGoogleSearchResponse(
      JSON.stringify({
        organic_results: [],
        zero_results_for_original_query: true,
      }),
      "q",
    ).zeroResultsForOriginalQuery,
    true,
  );
});

test("unresolved Google redirect results are named as a provider failure", () => {
  const unresolved = JSON.stringify({
    meta_data: {
      url: "https://www.google.com/search?q=Perth+agent",
      goto_urls: { found: 10, resolved: 0 },
    },
    organic_results: [
      { url: "/goto?url=CAESrAEB6zswFXO1wp9", title: "A", description: "d" },
      { url: "/goto?url=CAESrAEB7zswFXO2wp9", title: "B", description: "d" },
    ],
    zero_results_for_original_query: false,
  });
  assert.throws(
    () => parseGoogleSearchResponse(unresolved, "Perth agent"),
    /goto_urls_unresolved/,
  );

  // A partially resolved response is still a per-result problem, not a
  // provider capability failure.
  const mixed = JSON.stringify({
    meta_data: {
      url: "https://www.google.com/search?q=Perth+agent",
      goto_urls: { found: 10, resolved: 9 },
    },
    organic_results: [{ url: "/goto?url=CAESrAEB6zswFXO1wp9" }],
  });
  assert.throws(
    () => parseGoogleSearchResponse(mixed, "Perth agent"),
    /result_url_missing/,
  );

  // Resolved absolute links parse exactly as before.
  const resolved = parseGoogleSearchResponse(
    JSON.stringify({
      meta_data: {
        url: "https://www.google.com/search?q=Perth+agent",
        goto_urls: { found: 1, resolved: 1 },
      },
      organic_results: [{ url: "https://facebook.com/x", title: "X" }],
    }),
    "Perth agent",
  );
  assert.equal(resolved.results[0].url, "https://facebook.com/x");
});

test("repeated provider resolution failures stop paid searches before any request", async () => {
  const degraded = [
    { outcome: "blocked", error: "google_search_goto_urls_unresolved" },
    { outcome: "blocked", error: "google_search_result_url_missing" },
    { outcome: "blocked", error: "google_search_result_url_missing" },
  ];
  await withHarness({ attemptHistory: degraded }, async (h) => {
    const result = await h.fn({
      entity: { kind: "agent", id: "a1" },
      query: "q",
      job: { id: "job-1" },
    });
    assert.equal(result.error, "google_search_provider_degraded");
    assert.equal(result.actualAttempted, false);
    assert.equal(h.fetchCalls.length, 0);
    assert.equal(h.settleCalls.length, 0);
    assert.equal([...h.runRows.values()][0].provider_request_count, 0);
    assert.equal([...h.runRows.values()][0].provider_credits, 0);
  });

  // One success inside the window keeps the paid path open.
  await withHarness(
    {
      attemptHistory: [
        { outcome: "success", error: null },
        ...degraded.slice(0, 2),
      ],
    },
    async (h) => {
      const result = await h.fn({
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1" },
      });
      assert.notEqual(result.error, "google_search_provider_degraded");
      assert.equal(h.fetchCalls.length, 1);
    },
  );

  // An unrelated failure reason is not provider degradation.
  await withHarness(
    {
      attemptHistory: [
        { outcome: "blocked", error: "google_search_provider_http_403" },
        ...degraded.slice(0, 2),
      ],
    },
    async (h) => {
      const result = await h.fn({
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1" },
      });
      assert.notEqual(result.error, "google_search_provider_degraded");
      assert.equal(h.fetchCalls.length, 1);
    },
  );

  // Too little history is not proof of degradation.
  await withHarness({ attemptHistory: degraded.slice(0, 2) }, async (h) => {
    const result = await h.fn({
      entity: { kind: "agent", id: "a1" },
      query: "q",
      job: { id: "job-1" },
    });
    assert.notEqual(result.error, "google_search_provider_degraded");
    assert.equal(h.fetchCalls.length, 1);
  });
});

test("rejects bad JSON, provider errors, missing results, invalid result URLs, and query mismatch", () => {
  assert.throws(() => parseGoogleSearchResponse("{", "q"), /invalid_json/);
  assert.throws(
    () => parseGoogleSearchResponse(JSON.stringify({ error: "bad" }), "q"),
    /blocked_or_error/,
  );
  assert.throws(
    () =>
      parseGoogleSearchResponse(
        JSON.stringify({ organic_results: [{ title: "no url" }] }),
        "q",
      ),
    /missing/,
  );
  assert.throws(
    () =>
      parseGoogleSearchResponse(
        JSON.stringify({
          meta_data: { url: "https://google.test/?q=other" },
          organic_results: [],
        }),
        "q",
      ),
    /query_mismatch/,
  );
});

test("completes the reserve, journal, source, settle, and fetch-run finalization lifecycle", async () => {
  await withHarness(
    {
      responses: response(
        200,
        JSON.stringify({
          meta_data: { url: "https://www.google.com/search?q=q" },
          organic_results: [
            { url: "https://facebook.com/x", title: "X", description: "Y" },
          ],
          zero_results_for_original_query: false,
        }),
      ),
    },
    async (h) => {
      const result = await h.fn({
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: {
          id: "job-1",
          payload: { sweep_id: "sweep-1", build_run_id: "not-a-uuid" },
        },
      });
      assert.equal(result.complete, true);
      assert.equal(result.actualAttempted, true);
      assert.equal(h.fetchCalls.length, 1);
      const requestUrl = new URL(h.fetchCalls[0].url);
      assert.deepEqual(Object.fromEntries(requestUrl.searchParams), {
        search: "q",
        country_code: "au",
        light_request: "true",
        page: "1",
        pages: "1",
        search_type: "classic",
        nfpr: "true",
      });
      assert.equal(
        h.fetchCalls[0].init.headers.Authorization,
        "Bearer secret-key",
      );
      assert.equal(h.settleCalls.length, 1);
      assert.equal(h.settleCalls[0].p_charge_known, true);
      assert.equal(h.settleCalls[0].p_actual_credits, 10);
      const run = [...h.runRows.values()][0];
      assert.equal(run.build_run_id, null);
      assert.equal(run.source_provider, "scrapingbee_google_search");
      assert.equal(run.trigger, "discovery");
      assert.equal(run.target_kind, "search_query");
      assert.equal(run.scan_mode, null);
      assert.equal(run.status, "success");
      assert.equal(run.completed_at, "2026-09-08T00:00:01.000Z");
      assert.equal(run.source_document_id, SOURCE_ID);
      assert.equal(run.provider_credits, 10);
      assert.equal(run.result_summary.zero_results_for_original_query, false);
    },
  );
});

test("source persistence failure is retryable and replay pays and settles only once", async () => {
  await withHarness(
    {
      sourceFailures: 1,
      querySecret: "secret search",
      responses: response(200, JSON.stringify({ organic_results: [] })),
    },
    async (h) => {
      await assert.rejects(
        h.fn({
          entity: { kind: "agent", id: "a1" },
          query: "secret search",
          job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
        }),
        (error) =>
          error.retryable === true &&
          !error.message.includes("secret-key") &&
          !error.message.includes("secret search"),
      );
      const retried = await h.fn({
        entity: { kind: "agent", id: "a1" },
        query: "secret search",
        job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
      });
      assert.equal(retried.complete, true);
      assert.equal(h.fetchCalls.length, 1);
      assert.equal(h.settleCalls.length, 1);
      assert.equal(h.sourceCalls.length, 2);
    },
  );
});

test("403 is failed with evidence on fresh request and replay without another settlement", async () => {
  await withHarness(
    { responses: response(403, JSON.stringify({ error: "blocked" })) },
    async (h) => {
      const input = {
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
      };
      const fresh = await h.fn(input);
      const replay = await h.fn(input);
      for (const result of [fresh, replay]) {
        assert.equal(result.complete, false);
        assert.equal(result.actualAttempted, true);
        assert.match(result.error, /provider_http_403/);
        assert.equal(result.sourceDocumentId, SOURCE_ID);
      }
      assert.equal(h.fetchCalls.length, 1);
      assert.equal(h.settleCalls.length, 1);
    },
  );
});

test("query mismatch is failed with evidence on fresh request and replay", async () => {
  await withHarness(
    {
      responses: response(
        200,
        JSON.stringify({
          meta_data: { url: "https://www.google.com/search?q=other" },
          organic_results: [],
        }),
      ),
    },
    async (h) => {
      const input = {
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
      };
      const fresh = await h.fn(input);
      const replay = await h.fn(input);
      assert.match(fresh.error, /query_mismatch/);
      assert.match(replay.error, /query_mismatch/);
      assert.equal(fresh.actualAttempted, true);
      assert.equal(replay.actualAttempted, true);
      assert.equal(h.fetchCalls.length, 1);
      assert.equal(h.settleCalls.length, 1);
    },
  );
});

test("a new sweep changes the deterministic run key and makes a new provider request", async () => {
  await withHarness(
    {
      responses: [
        response(200, JSON.stringify({ organic_results: [] })),
        response(200, JSON.stringify({ organic_results: [] })),
      ],
    },
    async (h) => {
      const base = {
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
      };
      await h.fn(base);
      await h.fn({
        ...base,
        job: { ...base.job, payload: { sweep_id: "sweep-2" } },
      });
      assert.equal(h.fetchCalls.length, 2);
      assert.equal(h.runs.size, 2);
    },
  );
});

test("disabled and no-funds checks do not call the provider", async () => {
  await withHarness({ enabled: false }, async (h) => {
    const result = await h.fn({
      entity: { kind: "agent", id: "a1" },
      query: "q",
      job: { id: "job-1" },
    });
    assert.equal(result.actualAttempted, false);
    assert.equal(h.fetchCalls.length, 0);
    assert.equal([...h.runRows.values()][0].provider_request_count, 0);
  });
  await withHarness(
    { balanceEvidence: async () => ({ remaining: 9, verifiedAt: "now" }) },
    async (h) => {
      const result = await h.fn({
        entity: { kind: "agent", id: "a1" },
        query: "q",
        job: { id: "job-1" },
      });
      assert.equal(result.error, "google_search_no_funds");
      assert.equal(result.actualAttempted, false);
      assert.equal(h.fetchCalls.length, 0);
      assert.equal(h.settleCalls.length, 0);
    },
  );
});

test("bad JSON is incomplete but attempted, evidenced, settled, and finalized failed", async () => {
  await withHarness({ responses: response(200, "{") }, async (h) => {
    const result = await h.fn({
      entity: { kind: "agent", id: "a1" },
      query: "q",
      job: { id: "job-1", payload: { sweep_id: "sweep-1" } },
    });
    assert.equal(result.complete, false);
    assert.equal(result.actualAttempted, true);
    assert.equal(result.error, "google_search_invalid_json");
    assert.equal(result.sourceDocumentId, SOURCE_ID);
    assert.equal(h.settleCalls.length, 1);
    assert.equal([...h.runRows.values()][0].status, "failed");
  });
});
