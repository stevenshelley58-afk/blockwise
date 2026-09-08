import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFacebookPageIdentityEvidence,
  exactFacebookUrl,
  parseFacebookPageIdentity,
} from "../hermes/tools/research-runtime/bin/facebook-page-identity.mjs";
const RUNS = [
    "11111111-1111-5111-8111-111111111111",
    "33333333-3333-5333-8333-333333333333",
    "55555555-5555-5555-8555-555555555555",
  ],
  SOURCE = "22222222-2222-5222-8222-222222222222";
function response(
  status,
  body,
  headers = { "spb-cost": "1", "spb-request-id": "request-1" },
) {
  const h = new Map(Object.entries(headers));
  return {
    status,
    headers: { get: (k) => h.get(k) ?? null },
    text: async () => body,
  };
}
function harness(root, o = {}) {
  const keys = new Map(),
    runs = new Map(),
    attempts = new Map(),
    fetches = [],
    settles = [],
    sources = [],
    events = [];
  let n = 0,
    fail = o.sourceFailures || 0;
  const rest = async (_s, path, request = {}) => {
    if (request.method === "POST" && path === "ad_fetch_runs") {
      const row = JSON.parse(request.body);
      let id = keys.get(row.idempotency_key);
      if (!id) {
        id =
          RUNS[n++] || "77777777-7777-5777-8777-" + String(n).padStart(12, "0");
        keys.set(row.idempotency_key, id);
        runs.set(id, { id, ...row });
      }
      return [{ id }];
    }
    if (request.method === "PATCH" && path.startsWith("ad_fetch_runs?id=eq.")) {
      const id = decodeURIComponent(path.slice(20)),
        patch = JSON.parse(request.body),
        old = runs.get(id);
      if (!old) return [];
      runs.set(id, { ...old, ...patch });
      events.push({ type: "close", id, patch });
      return [{ id, ...runs.get(id) }];
    }
    if (path.startsWith("provider_credit_attempts?")) {
      const id = decodeURIComponent(
        path.match(/attempt_id=eq\.([^&]+)/)?.[1] || "",
      );
      return attempts.has(id) ? [{ ...attempts.get(id) }] : [];
    }
    throw new Error(
      "unexpected REST " + (request.method || "GET") + " " + path,
    );
  };
  const rpc = async (name, payload) => {
    events.push({ type: "rpc", name, payload });
    if (name === "reserve_provider_attempt_credits") {
      if (attempts.has(payload.p_attempt_id))
        return {
          status: attempts.get(payload.p_attempt_id).status,
          idempotent: true,
        };
      attempts.set(payload.p_attempt_id, {
        attempt_id: payload.p_attempt_id,
        provider: "scrapingbee",
        run_id: payload.p_run_id,
        status: "reserved",
        outcome: null,
        charge_known: null,
        actual_credits: null,
        reserved_credits: 1,
        run_credit_cap: 1,
      });
      return { status: "reserved" };
    }
    if (name === "settle_provider_attempt_credits") {
      settles.push(payload);
      const a = attempts.get(payload.p_attempt_id);
      if (a)
        Object.assign(a, {
          status: "settled",
          outcome: payload.p_outcome,
          charge_known: payload.p_charge_known,
          actual_credits: payload.p_actual_credits,
        });
      return { status: "settled" };
    }
    throw new Error("unexpected RPC " + name);
  };
  const sourceDocument = async (...a) => {
    sources.push(a);
    if (fail-- > 0) throw new Error("source failed " + (o.apiKey || "secret"));
    return SOURCE;
  };
  const fn = createFacebookPageIdentityEvidence({
    rest,
    rpc,
    apiKey: o.apiKey ?? "secret",
    enabled: o.enabled ?? true,
    balanceEvidence:
      o.balanceEvidence || (async () => ({ remaining: 5, verifiedAt: "now" })),
    recordAttempt: async (row) => {
      events.push({ type: "record", row });
      return row;
    },
    patchAttempt: async (id, patch) =>
      events.push({ type: "patch", id, patch }),
    sourceDocument,
    rawEvidenceDir: root,
    now: () => "2026-09-08T00:00:01.000Z",
    captureMode: o.captureMode,
    creditCap: o.creditCap,
    renderJs: o.renderJs,
    fetchImpl: async (url, init) => {
      fetches.push({ url, init });
      if (o.fetchError) throw o.fetchError;
      return (
        (Array.isArray(o.responses)
          ? o.responses[fetches.length - 1]
          : o.responses) ||
        response(
          200,
          '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
        )
      );
    },
  });
  return { fn, keys, runs, attempts, fetches, settles, sources, events };
}
async function withHarness(o, fn) {
  const root = await mkdtemp(join(tmpdir(), "fb-identity-"));
  try {
    return await fn(harness(root, o));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const input = (sweep = "one", entity = { kind: "agent", id: "a" }) => ({
  exactUrl: "https://facebook.com/acme",
  entity,
  job: {
    id: "job-1",
    payload: { coverage_week: sweep, build_run_id: "not-a-uuid" },
  },
});
test("strict URL and parser proof reject routes, malformed encoding, user IDs, and substring permalinks", () => {
  assert.equal(
    exactFacebookUrl("https://www.facebook.com/Acme-Homes/").vanity,
    "acme-homes",
  );
  assert.equal(
    exactFacebookUrl("https://www.facebook.com/123MainStreet").vanity,
    "123mainstreet",
  );
  for (const url of [
    "https://u:p@facebook.com/acme",
    "https://facebook.com:443/acme",
    "https://facebook.com/groups/x",
    "https://facebook.com/acme%ZZ",
    "https://facebook.com/a/b",
    "https://facebook.com/profile.php?id=123456",
  ])
    assert.equal(exactFacebookUrl(url), null);
  assert.equal(
    parseFacebookPageIdentity(
      '{"userID":"123456"}',
      "https://facebook.com/acme",
    ),
    null,
  );
  assert.equal(
    parseFacebookPageIdentity(
      '{"page_id":"123456","permalink_url":"https://facebook.com/acme-other"}',
      "https://facebook.com/acme",
    ),
    null,
  );
  assert.equal(
    parseFacebookPageIdentity(
      '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
      "https://facebook.com/acme",
    ).pageId,
    "123456",
  );
  assert.equal(
    parseFacebookPageIdentity(
      '<script>{"data":{"__typename":"Page","id":"987654","url":"https://www.facebook.com/acme","profile_picture":{"uri":"x"}}}</script>',
      "https://facebook.com/acme",
    ).pageId,
    "987654",
  );
  assert.deepEqual(
    parseFacebookPageIdentity("{}", "https://facebook.com/123456"),
    { pageId: "123456", permalinkMatch: true, evidenceKind: "numeric_url" },
  );
});
test("free HTML identity requires exact canonical URLs, one matching object, and matching app links", () => {
  const exactUrl = "https://www.facebook.com/acme";
  const body = [
    '<meta property="og:url" content="https://www.facebook.com/acme/" />',
    '<link rel="canonical" href="https://www.facebook.com/acme/" />',
    '<meta property="al:android:url" content="fb://profile/123456" />',
    '<meta property="al:ios:url" content="fb://profile/123456" />',
    '<script>{"userID":"123456","userVanity":"acme"}</script>',
  ].join("");
  assert.deepEqual(parseFacebookPageIdentity(body, exactUrl), {
    pageId: "123456",
    permalinkMatch: true,
    evidenceKind: "facebook_page_html_identity",
  });
  assert.equal(
    parseFacebookPageIdentity(
      body.replace(
        '<link rel="canonical" href="https://www.facebook.com/acme/" />',
        "",
      ),
      exactUrl,
    ),
    null,
  );
  assert.equal(
    parseFacebookPageIdentity(
      body.replace("fb://profile/123456", "fb://profile/654321"),
      exactUrl,
    ),
    null,
  );
  assert.equal(
    parseFacebookPageIdentity(
      body.replace('"userVanity":"acme"', '"userVanity":"other"'),
      exactUrl,
    ),
    null,
  );
});
test("completes one paid lifecycle with bearer auth, journal-first evidence, settlement, and final run", async () => {
  await withHarness({}, async (h) => {
    const r = await h.fn(input());
    assert.equal(r.pageId, "123456");
    assert.equal(r.pageUrl, "https://facebook.com/acme");
    assert.equal(r.actualAttempted, true);
    assert.equal(h.fetches.length, 1);
    const u = new URL(h.fetches[0].url);
    assert.equal(u.searchParams.get("api_key"), null);
    assert.equal(u.searchParams.get("render_js"), "false");
    assert.equal(u.searchParams.has("max_cost"), false);
    assert.equal(u.searchParams.get("premium_proxy"), "false");
    assert.equal(h.fetches[0].init.headers.Authorization, "Bearer secret");
    assert.equal(h.settles.length, 1);
    const run = [...h.runs.values()][0];
    assert.equal(run.build_run_id, null);
    assert.equal(run.scan_mode, null);
    assert.equal(run.target_kind, "advertiser_page");
    assert.equal(run.work_queue_id, "job-1");
    assert.equal(run.status, "success");
    assert.equal(run.completed_at, "2026-09-08T00:00:01.000Z");
    assert.equal(run.source_document_id, SOURCE);
    assert.equal(run.provider_request_count, 1);
    assert.equal(run.provider_credits, 1);
    assert.equal(
      h.events.findIndex((x) => x.type === "record") <
        h.events.findIndex((x) => x.type === "close"),
      true,
    );
  });
});
test("auto mode uses only the documented auto parameters and cap-specific key", async () => {
  await withHarness({ captureMode: "auto", creditCap: 5 }, async (h) => {
    await h.fn(input());
    const request = new URL(h.fetches[0].url);
    assert.deepEqual(Object.fromEntries(request.searchParams), {
      url: "https://www.facebook.com/acme",
      mode: "auto",
      max_cost: "5",
    });
    const reserve = h.events.find(
      (event) =>
        event.type === "rpc" &&
        event.name === "reserve_provider_attempt_credits",
    ).payload;
    assert.equal(reserve.p_reserved_credits, 5);
    assert.equal(reserve.p_run_credit_cap, 5);
    const run = [...h.runs.values()][0];
    assert.equal(run.result_summary.credit_cap, 5);
    assert.match(run.idempotency_key, /:auto:5:/);
    assert.deepEqual(
      h.events.find((event) => event.type === "record").row.request_params,
      { mode: "auto", max_cost: 5 },
    );
  });
});
test("capture mode only accepts fixed classic or capped auto configurations", () => {
  for (const options of [
    { captureMode: "classic", creditCap: 5 },
    { captureMode: "auto", creditCap: 2 },
    { captureMode: "auto", creditCap: 26 },
    { captureMode: "other", creditCap: 1 },
    { captureMode: "auto", creditCap: 5, renderJs: true },
  ]) {
    assert.throws(
      () => harness("/tmp/facebook-identity-invalid", options),
      /mode_not_approved/,
    );
  }
});
test("source write failure replays from journal, re-ingests source, and settles exactly once", async () => {
  await withHarness({ sourceFailures: 1 }, async (h) => {
    await assert.rejects(
      h.fn(input()),
      (e) => e.retryable === true && !e.message.includes("secret"),
    );
    const replay = await h.fn(input());
    assert.equal(replay.pageId, "123456");
    assert.equal(replay.replayed, true);
    assert.equal(h.fetches.length, 1);
    assert.equal(h.sources.length, 2);
    assert.equal(h.settles.length, 1);
    assert.equal([...h.runs.values()][0].status, "success");
  });
});
test("403 is evidence-backed and failed on fresh and replay without identity or another provider call", async () => {
  await withHarness(
    {
      responses: response(
        403,
        '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
      ),
    },
    async (h) => {
      const a = await h.fn(input()),
        b = await h.fn(input());
      for (const r of [a, b]) {
        assert.equal(r.pageId, null);
        assert.equal(r.actualAttempted, true);
        assert.match(r.error, /provider_http_403/);
      }
      assert.equal(h.fetches.length, 1);
      assert.equal(h.settles.length, 1);
      assert.equal(h.sources.length, 2);
      assert.equal([...h.runs.values()][0].status, "failed");
    },
  );
});
test("unknown-charge request retry never issues a second provider request", async () => {
  await withHarness(
    { fetchError: new Error("transport failed secret") },
    async (h) => {
      await assert.rejects(
        h.fn(input()),
        (e) => e.retryable === true && !e.message.includes("secret"),
      );
      await assert.rejects(h.fn(input()), (e) => e.retryable === true);
      assert.equal(h.fetches.length, 1);
      assert.equal(h.settles.length, 1);
      assert.equal([...h.runs.values()][0].status, "failed");
    },
  );
});
test("same weekly URL dedupes across entities while next weekly key makes a new paid request", async () => {
  await withHarness({}, async (h) => {
    await h.fn(input("one", { kind: "agent", id: "a" }));
    await h.fn(input("one", { kind: "agency", id: "b" }));
    await h.fn(input("two", { kind: "agency", id: "b" }));
    assert.equal(h.fetches.length, 2);
    assert.equal(h.keys.size, 2);
  });
});
test("production coverage version is paired with the changing build run and vanity case is one key", async () => {
  await withHarness({}, async (h) => {
    const make = (buildRun, url) => ({
      exactUrl: url,
      entity: { kind: "agent", id: "a" },
      job: {
        id: "job-1",
        payload: {
          directory_coverage_version: "directory-v2",
          build_run_id: buildRun,
        },
      },
    });
    const first = await h.fn(
      make("directory-v2:2957", "https://facebook.com/Foo"),
    );
    const same = await h.fn(
      make("directory-v2:2957", "https://facebook.com/foo"),
    );
    await h.fn(make("directory-v2:2958", "https://facebook.com/foo"));
    assert.equal(first.pageUrl, "https://facebook.com/Foo");
    assert.equal(same.replayed, true);
    assert.equal(h.fetches.length, 2);
    assert.equal(h.keys.size, 2);
  });
});
test("disabled and no-funds close a run without calling or settling the provider", async () => {
  await withHarness({ enabled: false }, async (h) => {
    const r = await h.fn(input());
    assert.equal(r.actualAttempted, false);
    assert.equal(h.fetches.length, 0);
    const run = [...h.runs.values()][0];
    assert.equal(run.status, "failed");
    assert.equal(run.provider_request_count, 0);
    assert.equal(run.provider_credits, 0);
  });
  await withHarness(
    { balanceEvidence: async () => ({ remaining: 0, verifiedAt: "now" }) },
    async (h) => {
      const r = await h.fn(input());
      assert.equal(r.error, "facebook_page_identity_no_funds");
      assert.equal(h.fetches.length, 0);
      assert.equal(h.settles.length, 0);
      assert.equal([...h.runs.values()][0].status, "failed");
    },
  );
});
test("provider initial status failure is rejected even with an HTTP 200 response", async () => {
  await withHarness(
    {
      responses: response(
        200,
        '{"__typename":"Page","userID":"123456","userVanity":"acme"}',
        { "spb-cost": "1", "spb-initial-status-code": "403" },
      ),
    },
    async (h) => {
      const r = await h.fn(input());
      assert.equal(r.pageId, null);
      assert.match(r.error, /initial_status_403/);
      assert.equal([...h.runs.values()][0].status, "failed");
    },
  );
});
