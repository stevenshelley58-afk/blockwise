import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveEffectiveModelProfile } from "../src/lib/ai/model-registry.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "migrations", "snapshot-provider-run-baseline.mjs");
const baseline = await import(pathToFileURL(scriptPath).href);

const providerRunColumns = [
  "id",
  "workspace_id",
  "created_at",
  "task_type",
  "model_profile",
  "provider_name",
  "provider_type",
  "model_name",
  "model_profile_version_id",
  "pricing_snapshot_id",
  "status",
  "cost_estimate",
  "estimated_cost_usd",
  "actual_cost_usd",
  "billing_status",
  "usage_json",
  "ai_run_id",
  "ai_usage_ledger_id",
];

const providerAttemptColumns = [
  "id",
  "workspace_id",
  "provider_run_id",
  "attempt_index",
  "provider_name",
  "provider_type",
  "model_name",
  "model_profile",
  "model_profile_version_id",
  "pricing_snapshot_id",
  "status",
  "request_submitted",
  "billing_status",
  "usage_json",
  "pricing_json",
  "estimated_cost_usd",
  "actual_cost_usd",
  "created_at",
];

type QueryCall = {
  table: string;
  columns?: string;
  filters: Array<{ operator: string; column?: string; value: unknown }>;
  orders: Array<{ column: string; options: unknown }>;
  limit?: number;
  range?: [number, number];
};

function queuedSupabase(pages: Record<string, unknown[][]>) {
  const calls: QueryCall[] = [];
  const queues = Object.fromEntries(Object.entries(pages).map(([table, values]) => [table, [...values]]));
  return {
    calls,
    from(table: string) {
      const call: QueryCall = { table, filters: [], orders: [] };
      calls.push(call);
      const query = {
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          call.filters.push({ operator: "eq", column, value });
          return query;
        },
        gt(column: string, value: unknown) {
          call.filters.push({ operator: "gt", column, value });
          return query;
        },
        gte(column: string, value: unknown) {
          call.filters.push({ operator: "gte", column, value });
          return query;
        },
        lt(column: string, value: unknown) {
          call.filters.push({ operator: "lt", column, value });
          return query;
        },
        or(value: string) {
          call.filters.push({ operator: "or", value });
          return query;
        },
        order(column: string, options: unknown) {
          call.orders.push({ column, options });
          return query;
        },
        limit(value: number) {
          call.limit = value;
          return query;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return query;
        },
        then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
          onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const page = queues[table]?.shift() ?? [];
          return Promise.resolve({ data: page, error: null }).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };
}

function profileSupabaseWithConcurrentInsert(before: Array<Record<string, unknown>>, after: Array<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  let request = 0;
  return {
    calls,
    from(table: string) {
      const call: QueryCall = { table, filters: [], orders: [] };
      calls.push(call);
      const query = {
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        gt(column: string, value: unknown) {
          call.filters.push({ operator: "gt", column, value });
          return query;
        },
        lt(column: string, value: unknown) {
          call.filters.push({ operator: "lt", column, value });
          return query;
        },
        or(value: string) {
          call.filters.push({ operator: "or", value });
          return query;
        },
        order(column: string, options: unknown) {
          call.orders.push({ column, options });
          return query;
        },
        limit(value: number) {
          call.limit = value;
          return query;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return query;
        },
        then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
          onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const source = [...(request++ === 0 ? before : after)].sort((left, right) =>
            String(right.active_from).localeCompare(String(left.active_from)) ||
            String(right.id).localeCompare(String(left.id)),
          );
          const compositeCursor = call.filters
            .filter((filter) => filter.operator === "or")
            .map((filter) => String(filter.value).match(/^active_from\.lt\.(.*),and\(active_from\.eq\.(.*),id\.lt\.(.*)\)$/))
            .find(Boolean);
          const idCursor = call.filters.find((filter) => filter.operator === "gt" && filter.column === "id")?.value;
          let data = compositeCursor
            ? source.filter((row) =>
                String(row.active_from) < compositeCursor[1] ||
                (String(row.active_from) === compositeCursor[2] && String(row.id) < compositeCursor[3]),
              )
            : idCursor === undefined
              ? source
              : source.filter((row) => String(row.id) > String(idCursor));
          if (call.range) data = data.slice(call.range[0], call.range[1] + 1);
          else if (call.limit !== undefined) data = data.slice(0, call.limit);
          return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };
}

function providerRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-alpha",
    workspace_id: "workspace-alpha",
    created_at: "2026-07-12T01:00:00.000Z",
    task_type: "adstudio.image",
    model_profile: "image_final",
    provider_name: "openai",
    provider_type: "image_generation",
    model_name: "gpt-image-2",
    model_profile_version_id: "version-final",
    pricing_snapshot_id: "version-final",
    status: "completed",
    cost_estimate: "1.2500",
    estimated_cost_usd: "1.250000",
    actual_cost_usd: "1.250000",
    billing_status: "actual",
    usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 1 },
    ai_run_id: "ai-run-alpha",
    ai_usage_ledger_id: "ledger-alpha",
    ...overrides,
  };
}

function providerAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-alpha",
    workspace_id: "workspace-alpha",
    provider_run_id: "run-alpha",
    attempt_index: 0,
    provider_name: "openai",
    provider_type: "image_generation",
    model_name: "gpt-image-2",
    model_profile: "image_final",
    model_profile_version_id: "version-final",
    pricing_snapshot_id: "version-final",
    status: "completed",
    request_submitted: true,
    billing_status: "actual",
    usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 1, complete: true },
    pricing_json: {
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 1.25,
      currency: "USD",
      inputTokenBasis: "per_million_tokens",
      outputTokenBasis: "per_million_tokens",
      imageBasis: "per_output_image",
      source: "persisted",
      snapshotId: "version-final",
    },
    estimated_cost_usd: "1.250000",
    actual_cost_usd: "1.250000",
    created_at: "2026-07-12T01:00:01.000Z",
    ...overrides,
  };
}

function modelProfileVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-alpha",
    provider: "openai",
    model: "gpt-image-2",
    input_usd_per_million_tokens: 5,
    output_usd_per_million_tokens: 30,
    image_usd_per_unit: 0.211,
    supports_structured_output: false,
    max_context_tokens: 16_000,
    active_from: "2026-06-20T00:00:00.000Z",
    active_to: null,
    model_profiles: { key: "image_final" },
    ...overrides,
  };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  });
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("CLI validates dry-run-only arguments before attempting to load credentials", () => {
  const missingDryRun = runCli([]);
  assert.notEqual(missingDryRun.status, 0);
  assert.match(missingDryRun.stderr, /--dry-run is required/i);
  assert.doesNotMatch(missingDryRun.stderr, /missing env/i);

  const live = runCli(["--dry-run", "--execute"]);
  assert.notEqual(live.status, 0);
  assert.match(live.stderr, /live execution flags are forbidden/i);
  assert.doesNotMatch(live.stderr, /missing env/i);

  const unknown = runCli(["--dry-run", "--output=tracked.json"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unsupported argument/i);
  assert.doesNotMatch(unknown.stderr, /missing env/i);
});

test("module import has no CLI, credential, console, or network side effects", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module",
      "--eval",
      `globalThis.fetch=()=>{throw new Error("network called")};await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SECRET_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("credential loading uses the shared current-secret-first transport contract", () => {
  assert.deepEqual(
    baseline.requireEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.value",
      SUPABASE_SECRET_KEY: "sb_secret_current",
    }),
    { url: "https://example.supabase.co", serviceRoleKey: "sb_secret_current" },
  );
  assert.throws(
    () => baseline.requireEnv({ SUPABASE_URL: "https://example.supabase.co" }),
    /SUPABASE_SECRET_KEY \(or SUPABASE_SERVICE_ROLE_KEY\)/,
  );
});

test("provider-run reads select only approved evidence columns and scope every page to workspace and frozen window", async () => {
  const first = providerRun();
  const second = providerRun({ id: "run-beta", created_at: "2026-07-12T01:00:00.000Z" });
  const third = providerRun({ id: "run-gamma", created_at: "2026-07-12T02:00:00.000Z" });
  const supabase = queuedSupabase({ adstudio_provider_runs: [[first, second], [third], []] });
  const windowEnd = "2026-07-13T00:00:00.000Z";

  const rows = await baseline.loadProviderRunRows({
    supabase: supabase as never,
    workspaceId: "workspace-alpha",
    windowEnd,
    pageSize: 2,
  });

  assert.deepEqual(rows.map((row: { id: string }) => row.id), ["run-alpha", "run-beta", "run-gamma"]);
  assert.equal(supabase.calls.length, 3, "a short page is followed by an empty-page proof");
  for (const call of supabase.calls) {
    assert.equal(call.columns, providerRunColumns.join(","));
    assert.deepEqual(call.orders.map(({ column }) => column), ["created_at", "id"]);
    assert.ok(call.filters.some((filter) => filter.operator === "eq" && filter.column === "workspace_id" && filter.value === "workspace-alpha"));
    assert.ok(call.filters.some((filter) => filter.operator === "gte" && filter.column === "created_at" && filter.value === "1970-01-01T00:00:00.000Z"));
    assert.ok(call.filters.some((filter) => filter.operator === "lt" && filter.column === "created_at" && filter.value === windowEnd));
  }
  assert.equal(supabase.calls[0].filters.some((filter) => filter.operator === "or"), false);
  assert.match(String(supabase.calls[1].filters.find((filter) => filter.operator === "or")?.value), /created_at\.gt\..*created_at\.eq\..*id\.gt\.run-beta/);
});

test("provider-run reads fail closed on cross-workspace, out-of-window, or non-advancing rows", async () => {
  const windowEnd = "2026-07-13T00:00:00.000Z";
  const cases = [
    [providerRun({ workspace_id: "workspace-other" })],
    [providerRun({ created_at: windowEnd })],
    [providerRun({ created_at: "2026-07-13T00:00:00+00:00" })],
    [providerRun(), providerRun()],
  ];

  for (const page of cases) {
    const supabase = queuedSupabase({ adstudio_provider_runs: [page] });
    await assert.rejects(
      baseline.loadProviderRunRows({
        supabase: supabase as never,
        workspaceId: "workspace-alpha",
        windowEnd,
        pageSize: 10,
      }),
      /workspace|window|strictly ordered/i,
    );
  }
});

test("provider-attempt reads capture exact accounting fields with workspace and frozen-window scoping", async () => {
  const first = providerAttempt();
  const second = providerAttempt({ id: "attempt-beta", attempt_index: 1, created_at: "2026-07-12T01:00:02.000Z" });
  const supabase = queuedSupabase({ adstudio_provider_run_attempts: [[first], [second], []] });
  const windowEnd = "2026-07-13T00:00:00.000Z";

  const rows = await baseline.loadProviderAttemptRows({
    supabase: supabase as never,
    workspaceId: "workspace-alpha",
    windowEnd,
    pageSize: 1,
  });

  assert.deepEqual(rows.map((row: { id: string }) => row.id), ["attempt-alpha", "attempt-beta"]);
  assert.equal(supabase.calls.length, 3);
  for (const call of supabase.calls) {
    assert.equal(call.columns, providerAttemptColumns.join(","));
    assert.deepEqual(call.orders.map(({ column }) => column), ["created_at", "id"]);
    assert.ok(call.filters.some((filter) => filter.operator === "eq" && filter.column === "workspace_id" && filter.value === "workspace-alpha"));
    assert.ok(call.filters.some((filter) => filter.operator === "lt" && filter.column === "created_at" && filter.value === windowEnd));
  }
});

test("workspace IDs are enumerated fully in memory before provider-run passes", async () => {
  const supabase = queuedSupabase({
    workspaces: [[{ id: "workspace-beta" }], [{ id: "workspace-alpha" }], []],
  });

  assert.deepEqual(await baseline.listWorkspaceIds({ supabase: supabase as never, pageSize: 10 }), [
    "workspace-alpha",
    "workspace-beta",
  ]);
  assert.equal(supabase.calls.length, 3);
  assert.equal(supabase.calls.every((call) => call.table === "workspaces"), true);
  assert.equal(supabase.calls.some((call) => call.filters.some((filter) => filter.column === "workspace_id")), false);
});

test("profile resolution uses active persisted primaries and committed runtime defaults and fallbacks", () => {
  const rawVersionId = "22222222-2222-4222-8222-222222222222";
  const evidence = baseline.resolveModelProfileEvidence([
    {
      id: rawVersionId,
      provider: "openrouter",
      model: "google/gemini-2.5-flash-image",
      input_usd_per_million_tokens: "0.3",
      output_usd_per_million_tokens: "2.5",
      image_usd_per_unit: "0.039",
      supports_structured_output: false,
      max_context_tokens: 65_536,
      active_from: "2026-07-01T00:00:00.000Z",
      active_to: null,
      model_profiles: { key: "image_draft" },
    },
  ], resolveEffectiveModelProfile);

  assert.deepEqual(evidence.map((profile: { profileKey: string }) => profile.profileKey), [
    "image_draft",
    "image_final",
    "structured_json",
    "vision_classification",
  ]);
  const draft = evidence.find((profile: { profileKey: string }) => profile.profileKey === "image_draft");
  assert.equal(draft.source, "persisted");
  assert.equal(draft.primary.provider, "openrouter");
  assert.equal(draft.primary.model, "google/gemini-2.5-flash-image");
  assert.match(draft.activeVersionIdSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(draft.fallbacks, []);

  const final = evidence.find((profile: { profileKey: string }) => profile.profileKey === "image_final");
  assert.equal(final.source, "default");
  assert.equal(final.primary.provider, "google");
  assert.equal(final.primary.model, "gemini-3.1-flash-image");
  assert.deepEqual(final.fallbacks.map((candidate: { provider: string; model: string }) => [candidate.provider, candidate.model]), [
    ["openai", "gpt-image-2"],
  ]);
  assert.equal(final.activeVersionIdSha256, null);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(rawVersionId));
});

test("profile-version query freezes runtime resolution at the same exclusive cutoff", async () => {
  const supabase = queuedSupabase({ model_profile_versions: [
    [modelProfileVersion()],
    [modelProfileVersion({
      id: "version-beta",
      model: "gpt-5.5",
      active_from: "2026-06-10T00:00:00.000Z",
      model_profiles: { key: "structured_json" },
    })],
    [],
  ] });
  const windowEnd = "2026-07-13T00:00:00.000Z";

  const rows = await baseline.loadActiveProfileVersionRows({ supabase: supabase as never, windowEnd, pageSize: 1 });

  assert.deepEqual(rows.map((row: { id: string }) => row.id), ["version-alpha", "version-beta"]);
  assert.equal(supabase.calls.length, 3);
  assert.equal(supabase.calls.every((call) => call.range === undefined && call.limit === 1), true);
  assert.deepEqual(
    supabase.calls.map((call) => call.filters.find((filter) =>
      filter.operator === "or" && String(filter.value).startsWith("active_from.lt.")
    )?.value ?? null),
    [
      null,
      "active_from.lt.2026-06-20T00:00:00.000Z,and(active_from.eq.2026-06-20T00:00:00.000Z,id.lt.version-alpha)",
      "active_from.lt.2026-06-10T00:00:00.000Z,and(active_from.eq.2026-06-10T00:00:00.000Z,id.lt.version-beta)",
    ],
  );
  for (const call of supabase.calls) {
    assert.equal(call.table, "model_profile_versions");
    assert.ok(call.filters.some((filter) => filter.operator === "lt" && filter.column === "active_from" && filter.value === windowEnd));
    assert.equal(call.filters.some((filter) => filter.operator === "or" && String(filter.value).includes(`active_to.gte.${windowEnd}`)), true);
    assert.deepEqual(call.orders.map(({ column }) => column), ["active_from", "id"]);
    assert.deepEqual(call.orders.map(({ options }) => options), [{ ascending: false }, { ascending: false }]);
  }
});

test("profile-version composite keyset does not shift or skip when a row is inserted before the cursor", async () => {
  const beta = modelProfileVersion({ id: "version-beta" });
  const alpha = modelProfileVersion({
    id: "version-alpha",
    model_profiles: { key: "structured_json" },
  });
  const insertedBeforeCursor = modelProfileVersion({
    id: "version-gamma",
    model_profiles: { key: "vision_classification" },
  });
  const supabase = profileSupabaseWithConcurrentInsert([beta, alpha], [insertedBeforeCursor, beta, alpha]);

  const rows = await baseline.loadActiveProfileVersionRows({
    supabase: supabase as never,
    windowEnd: "2026-07-13T00:00:00.000Z",
    pageSize: 1,
  });

  assert.deepEqual(rows.map((row: { id: string }) => row.id), ["version-beta", "version-alpha"]);
  assert.equal(supabase.calls.every((call) => call.range === undefined && call.limit === 1), true);
  assert.equal(supabase.calls[1].filters.some((filter) =>
    filter.operator === "or" &&
    filter.value === "active_from.lt.2026-06-20T00:00:00.000Z,and(active_from.eq.2026-06-20T00:00:00.000Z,id.lt.version-beta)"
  ), true);
});

test("profile-version keyset pagination rejects a non-advancing duplicate page", async () => {
  const duplicate = modelProfileVersion();
  const supabase = queuedSupabase({ model_profile_versions: [[duplicate], [duplicate], []] });
  await assert.rejects(
    baseline.loadActiveProfileVersionRows({
      supabase: supabase as never,
      windowEnd: "2026-07-13T00:00:00.000Z",
      pageSize: 1,
    }),
    /duplicate|did not advance/i,
  );
  assert.equal(supabase.calls[1].filters.some((filter) =>
    filter.operator === "or" &&
    filter.value === `active_from.lt.${duplicate.active_from},and(active_from.eq.${duplicate.active_from},id.lt.${duplicate.id})`
  ), true);
});

test("profile resolution rejects overlapping active versions for one profile", () => {
  assert.throws(
    () => baseline.resolveModelProfileEvidence([
      modelProfileVersion(),
      modelProfileVersion({ id: "version-overlap", active_from: "2026-06-21T00:00:00.000Z" }),
    ], resolveEffectiveModelProfile),
    /ambiguous active model profile/i,
  );
});

test("manifest contains exact run and attempt evidence and reconciles a failed-but-billed cascade", () => {
  const rows = [providerRun({ usage_json: { inputTokens: 50_000, outputTokens: 0, imageUnits: 1 } })];
  const attempts = [
    providerAttempt({
      id: "attempt-failed-billed",
      status: "failed",
      usage_json: { inputTokens: 50_000, outputTokens: 0, imageUnits: 0, complete: true },
      estimated_cost_usd: "0.250000",
      actual_cost_usd: "0.250000",
    }),
    providerAttempt({
      id: "attempt-success",
      attempt_index: 1,
      created_at: "2026-07-12T01:00:02.000Z",
      usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 1, complete: true },
      pricing_json: { ...providerAttempt().pricing_json, imageUsdPerUnit: 1 },
      estimated_cost_usd: "1.000000",
      actual_cost_usd: "1.000000",
    }),
  ];
  const modelProfiles = baseline.resolveModelProfileEvidence([], resolveEffectiveModelProfile);
  const manifest = baseline.buildProviderBaselineManifest({
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    dependencyClosureSha256: "c".repeat(64),
    dependencyClosure: [{ path: "provider-baseline.mjs", sha256: "a".repeat(64) }],
    capturedAtStart: "2026-07-13T00:00:00.000Z",
    capturedAtEnd: "2026-07-13T00:00:05.000Z",
    windowEnd: "2026-07-13T00:00:00.000Z",
    workspaceIds: ["workspace-alpha"],
    firstPassRows: rows,
    secondPassRows: rows,
    firstPassAttempts: attempts,
    secondPassAttempts: attempts,
    modelProfiles,
  });

  assert.equal(manifest.schema, "adstudio-provider-run-baseline/v1");
  assert.match(manifest.schemaSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.capture.window.startInclusive, "1970-01-01T00:00:00.000Z");
  assert.equal(manifest.capture.window.endExclusive, "2026-07-13T00:00:00.000Z");
  assert.match(manifest.query.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.modelProfiles.query.pagination, "active-from-id-descending-keyset-until-empty");
  assert.equal(manifest.source.commit, "f".repeat(40));
  assert.match(manifest.source.commitSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.source.toolSha256, "a".repeat(64));
  assert.equal(manifest.source.dependencyClosureSha256, "c".repeat(64));
  assert.deepEqual(manifest.source.dependencyClosure, [{ path: "provider-baseline.mjs", sha256: "a".repeat(64) }]);
  assert.equal(manifest.drift.detected, false);
  assert.equal(manifest.drift.firstPassSha256, manifest.drift.secondPassSha256);
  assert.equal(manifest.acceptanceEligible, true);
  assert.equal(manifest.publicSummary.totalRuns, 1);
  assert.equal(manifest.publicSummary.totalAttempts, 2);
  assert.match(manifest.publicSummary.workspaceIdSetSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.publicSummary.globalRunIdSetSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.publicSummary.globalAttemptIdSetSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.publicSummary.workspaces.map((workspace: { runCount: number }) => workspace.runCount), [1]);
  assert.deepEqual(manifest.publicSummary.workspaces.map((workspace: { attemptCount: number }) => workspace.attemptCount), [2]);
  assert.match(manifest.publicSummary.workspaces[0].attemptIdSetSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.publicSummary.workspaces.every((workspace: { pseudonym: string }) => /^workspace-[a-f0-9]{16}$/.test(workspace.pseudonym)), true);
  assert.equal(manifest.publicSummary.cost.positive.count, 1);
  assert.equal(manifest.publicSummary.cost.positive.sum, "1.25");
  assert.equal(manifest.publicSummary.cost.zero.count, 0);
  assert.equal(manifest.publicSummary.cost.zero.sum, "0");
  assert.equal(manifest.publicSummary.cost.negative.count, 0);
  assert.equal(manifest.publicSummary.cost.negative.sum, "0");
  assert.equal(manifest.publicSummary.attemptAccounting.failedBilledCount, 1);
  assert.equal(manifest.publicSummary.attemptAccounting.failedBilledCostUsd, "0.25");
  assert.equal(manifest.publicSummary.attemptAccounting.estimatedCostUsd, "1.25");
  assert.equal(manifest.publicSummary.attemptAccounting.actualCostUsd, "1.25");
  assert.equal(manifest.publicSummary.attemptAccounting.runMismatchCount, 0);
  assert.deepEqual(manifest.publicSummary.attemptAccountingPolicy, {
    arithmetic: "exact-base-10",
    formula: "inputTokens*inputUsdPerMillionTokens/1000000 + outputTokens*outputUsdPerMillionTokens/1000000 + imageUnits*imageUsdPerUnit",
    rounding: "half-away-from-zero-to-6-decimal-places",
    comparison: "exact-after-rounding",
    toleranceUsd: "0",
  });
  assert.deepEqual(manifest.publicSummary.links.aiRun, { linkedCount: 1, missingCount: 0 });
  assert.deepEqual(manifest.publicSummary.links.aiUsageLedger, { linkedCount: 1, missingCount: 0 });
  assert.equal(manifest.publicSummary.dimensionQuality.modelProfile.nullCount, 0);
  assert.equal(manifest.publicSummary.dimensionQuality.taskType.unknownCount, 0);
  assert.ok(manifest.publicSummary.grouped.taskType.some((group: { value: string; count: number }) => group.value === "adstudio.image" && group.count === 1));
  assert.ok(manifest.publicSummary.grouped.providerModel.some((group: { providerName: string; modelName: string; count: number }) => group.providerName === "openai" && group.modelName === "gpt-image-2" && group.count === 1));
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);

  assert.deepEqual(manifest.privateEvidence.workspaces.map((workspace: { workspaceId: string }) => workspace.workspaceId), [
    "workspace-alpha",
  ]);
  assert.deepEqual(Object.keys(manifest.privateEvidence.workspaces[0].rows[0]), providerRunColumns);
  assert.deepEqual(Object.keys(manifest.privateEvidence.workspaces[0].attempts[0]), providerAttemptColumns);
  assert.equal(manifest.privateEvidence.workspaces[0].attempts[0].actual_cost_usd, "0.250000");
  assert.equal(JSON.stringify(manifest.privateEvidence).includes("workspace-alpha"), true);
  assert.equal(JSON.stringify(manifest.publicSummary).includes("workspace-alpha"), false);
  assert.equal(JSON.stringify(manifest.publicSummary).includes("run-alpha"), false);
});

test("accounting anomalies independently block otherwise drift-free evidence", () => {
  const build = (run: Record<string, unknown>, attempts: Array<Record<string, unknown>>) => {
    const modelProfiles = baseline.resolveModelProfileEvidence([], resolveEffectiveModelProfile);
    return baseline.buildProviderBaselineManifest({
      projectRef: "project-ref",
      sourceCommit: "f".repeat(40),
      toolSourceSha256: "a".repeat(64),
      dependencyClosureSha256: "c".repeat(64),
      dependencyClosure: [{ path: "provider-baseline.mjs", sha256: "a".repeat(64) }],
      capturedAtStart: "2026-07-13T00:00:00.000Z",
      capturedAtEnd: "2026-07-13T00:00:05.000Z",
      windowEnd: "2026-07-13T00:00:00.000Z",
      workspaceIds: ["workspace-alpha"],
      firstPassRows: [run],
      secondPassRows: [run],
      firstPassAttempts: attempts,
      secondPassAttempts: attempts,
      modelProfiles,
    });
  };
  const cases = [
    {
      name: "negative cost",
      run: providerRun({ estimated_cost_usd: "-0.1", actual_cost_usd: "-0.1" }),
      attempts: [providerAttempt({ estimated_cost_usd: "-0.1", actual_cost_usd: "-0.1" })],
    },
    {
      name: "unreconciled cost",
      run: providerRun({ billing_status: "unreconciled", estimated_cost_usd: "0", actual_cost_usd: null }),
      attempts: [providerAttempt({ billing_status: "unreconciled", estimated_cost_usd: "0", actual_cost_usd: null })],
    },
    {
      name: "nonlocal charged-zero cost",
      run: providerRun({ cost_estimate: "0", estimated_cost_usd: "0", actual_cost_usd: "0" }),
      attempts: [providerAttempt({ estimated_cost_usd: "0", actual_cost_usd: "0" })],
    },
    {
      name: "missing run usage",
      run: providerRun({ usage_json: { inputTokens: 0, outputTokens: 0 } }),
      attempts: [providerAttempt()],
    },
    {
      name: "incomplete attempt usage",
      run: providerRun(),
      attempts: [providerAttempt({ usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 1, complete: false } })],
    },
    {
      name: "all-zero nonlocal usage",
      run: providerRun({ usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 0 } }),
      attempts: [providerAttempt({ usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 0, complete: true } })],
    },
    {
      name: "run-attempt aggregate mismatch",
      run: providerRun({ actual_cost_usd: "9.99" }),
      attempts: [providerAttempt()],
    },
    {
      name: "frozen pricing mismatch",
      anomaly: "pricingMismatchCount",
      run: providerRun(),
      attempts: [providerAttempt({
        pricing_json: {
          ...providerAttempt().pricing_json,
          imageUsdPerUnit: 9.99,
        },
      })],
    },
    {
      name: "empty frozen pricing scalar",
      anomaly: "missingPricingCount",
      run: providerRun(),
      attempts: [providerAttempt({
        pricing_json: {
          ...providerAttempt().pricing_json,
          imageUsdPerUnit: "",
        },
      })],
    },
    {
      name: "noncanonical frozen pricing basis",
      anomaly: "missingPricingCount",
      run: providerRun(),
      attempts: [providerAttempt({
        pricing_json: {
          ...providerAttempt().pricing_json,
          inputTokenBasis: "per_token",
        },
      })],
    },
    {
      name: "non-runtime frozen pricing source",
      anomaly: "missingPricingCount",
      run: providerRun(),
      attempts: [providerAttempt({
        pricing_json: {
          ...providerAttempt().pricing_json,
          source: "provider_reported",
        },
      })],
    },
    {
      name: "frozen pricing snapshot identity mismatch",
      anomaly: "missingPricingCount",
      run: providerRun(),
      attempts: [providerAttempt({
        pricing_json: {
          ...providerAttempt().pricing_json,
          snapshotId: "version-other",
        },
      })],
    },
    {
      name: "completed actual-billed attempt without provider submission",
      anomaly: "attemptSemanticsMismatchCount",
      run: providerRun(),
      attempts: [providerAttempt({ request_submitted: false })],
    },
  ];

  for (const fixture of cases) {
    const manifest = build(fixture.run, fixture.attempts);
    assert.equal(manifest.drift.detected, false, fixture.name);
    assert.equal(manifest.acceptanceEligible, false, fixture.name);
    assert.ok(manifest.publicSummary.anomalies.blockingCount > 0, fixture.name);
    if (fixture.anomaly) {
      assert.ok(manifest.publicSummary.anomalies[fixture.anomaly] > 0, fixture.name);
    }
  }

  const defaultPricing = build(
    providerRun({ model_profile_version_id: null, pricing_snapshot_id: null }),
    [providerAttempt({
      model_profile_version_id: null,
      pricing_snapshot_id: null,
      pricing_json: {
        ...providerAttempt().pricing_json,
        source: "default",
        snapshotId: null,
      },
    })],
  );
  assert.equal(defaultPricing.acceptanceEligible, true, "default pricing uses coherent null snapshot identity");
});

test("runner uses one in-memory workspace set, two passes with one cutoff, fails closed on drift, and never logs IDs", async () => {
  const workspaces = ["workspace-alpha", "workspace-beta"];
  const calls: Array<{ workspaceId: string; windowEnd: string }> = [];
  let pass = 0;
  const firstRows = [providerRun(), providerRun({ id: "run-gamma", workspace_id: "workspace-beta" })];
  const secondRows = [providerRun(), providerRun({ id: "run-changed", workspace_id: "workspace-beta" })];
  let writtenManifest: Record<string, unknown> | undefined;
  const logs: string[] = [];
  const times = ["2026-07-13T00:00:00.000Z", "2026-07-13T00:00:05.000Z"];
  let workspaceEnumerations = 0;

  const result = await baseline.runProviderBaseline({
    supabase: {} as never,
    repoRoot,
    outputPath: path.join(repoRoot, "artifacts", "adstudio", "evidence", "provider-runs-manifest.json"),
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    dependencyClosureSha256: "c".repeat(64),
    dependencyClosure: [{ path: "provider-baseline.mjs", sha256: "a".repeat(64) }],
    now: () => times.shift(),
    listWorkspaces: async () => {
      workspaceEnumerations += 1;
      return workspaces;
    },
    loadRows: async ({ workspaceId, windowEnd }: { workspaceId: string; windowEnd: string }) => {
      calls.push({ workspaceId, windowEnd });
      if (workspaceId === "workspace-beta") pass += 1;
      const sourceRows = pass <= 1 ? firstRows : secondRows;
      return sourceRows.filter((row) => row.workspace_id === workspaceId);
    },
    loadAttempts: async () => [],
    loadProfiles: async () => [],
    resolveProfiles: () => [],
    writeManifest: async ({ manifest, outputPath }: { manifest: Record<string, unknown>; outputPath: string }) => {
      writtenManifest = manifest;
      return { outputPath, byteLength: 1, fileSha256: "b".repeat(64), permissionsVerified: true };
    },
    logger: (message: string) => logs.push(message),
  });

  assert.equal(workspaceEnumerations, 1);
  assert.deepEqual(calls.map(({ workspaceId }) => workspaceId), [
    "workspace-alpha",
    "workspace-beta",
    "workspace-alpha",
    "workspace-beta",
  ]);
  assert.equal(new Set(calls.map(({ windowEnd }) => windowEnd)).size, 1);
  assert.equal(calls[0].windowEnd, "2026-07-13T00:00:00.000Z");
  assert.equal(result.exitCode, 1);
  assert.equal((writtenManifest?.drift as { detected: boolean }).detected, true);
  assert.equal(writtenManifest?.acceptanceEligible, false);
  const output = logs.join("\n");
  assert.doesNotMatch(output, /workspace-alpha|workspace-beta|run-alpha|run-gamma|run-changed|project-ref/);
  assert.match(output, /runs scanned: 2/i);
  assert.match(output, /drift detected: yes/i);
  assert.match(output, new RegExp("b".repeat(64)));
});

test("secure manifest writer is ignored, repository-confined, atomic, exclusive, and private", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-provider-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  runGit(root, ["init", "--quiet"]);
  await writeFile(path.join(root, ".gitignore"), "artifacts/\n", "utf8");
  const outputPath = path.join(root, "artifacts", "adstudio", "evidence", "provider-runs-manifest.json");

  const written = await baseline.writeSecureManifest({
    repoRoot: root,
    outputPath,
    manifest: { schema: "fixture", privateEvidence: { workspaceId: "raw-only-here" } },
  });

  assert.equal(written.outputPath, outputPath);
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).privateEvidence.workspaceId, "raw-only-here");
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["provider-runs-manifest.json"]);
  assert.equal(written.permissionsVerified, true);
  if (process.platform !== "win32") assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  await assert.rejects(
    baseline.writeSecureManifest({ repoRoot: root, outputPath, manifest: { schema: "second" } }),
    /already exists/i,
  );
  await assert.rejects(
    baseline.writeSecureManifest({ repoRoot: root, outputPath: path.join(root, "outside.json"), manifest: {} }),
    /artifacts directory/i,
  );
});

test("tool provenance requires a tracked clean executable that exactly matches HEAD", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-provider-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  runGit(root, ["init", "--quiet"]);
  const toolPath = path.join(root, "provider-baseline.mjs");
  const dependencyPath = path.join(root, "dependency.mjs");
  const source = "import \"./dependency.mjs\";\nexport const evidenceVersion = 1;\n";
  const dependencySource = "export const dependencyVersion = 1;\n";
  await writeFile(toolPath, source, "utf8");
  await writeFile(dependencyPath, dependencySource, "utf8");
  runGit(root, ["add", "provider-baseline.mjs", "dependency.mjs"]);
  runGit(root, [
    "-c",
    "user.name=AdStudio Test",
    "-c",
    "user.email=adstudio-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);

  const evidence = await baseline.collectVerifiedToolEvidence({ repoRoot: root, scriptPath: toolPath });
  assert.match(evidence.sourceCommit, /^[a-f0-9]{40,64}$/);
  assert.equal(evidence.toolSourceSha256, createHash("sha256").update(source).digest("hex"));
  assert.match(evidence.dependencyClosureSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(evidence.dependencyClosure.map((file: { path: string }) => file.path), [
    "dependency.mjs",
    "provider-baseline.mjs",
  ]);

  await writeFile(dependencyPath, `${dependencySource}// dirty\n`, "utf8");
  await assert.rejects(
    baseline.collectVerifiedToolEvidence({ repoRoot: root, scriptPath: toolPath }),
    /dependency closure must be tracked and match HEAD/i,
  );
  await writeFile(dependencyPath, dependencySource, "utf8");

  await writeFile(toolPath, `${source}// dirty\n`, "utf8");
  await assert.rejects(
    baseline.collectVerifiedToolEvidence({ repoRoot: root, scriptPath: toolPath }),
    /tracked and match HEAD/i,
  );
  const untrackedPath = path.join(root, "untracked.mjs");
  await writeFile(untrackedPath, source, "utf8");
  await assert.rejects(
    baseline.collectVerifiedToolEvidence({ repoRoot: root, scriptPath: untrackedPath }),
    /tracked and match HEAD/i,
  );
});

test("executable is strictly read-only and carries no forbidden payload fields or provider-call path", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /supabase-server-credential\.mjs/);
  assert.match(source, /createSupabaseServerClient/);
  assert.match(source, /secure-manifest\.mjs/);
  assert.doesNotMatch(source, /\.from\([^)]*\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(source, /\.(?:rpc|upload|remove)\s*\(/);
  assert.doesNotMatch(source, /input_json|output_json|error_json|correlation_id|mutation_id|payload_hash|provider_request|outbox/i);
  assert.doesNotMatch(source, /generateImage|createTextProvider|fetch\s*\(/i);
  assert.deepEqual(baseline.PROVIDER_RUN_COLUMNS, providerRunColumns);
  assert.deepEqual(baseline.PROVIDER_ATTEMPT_COLUMNS, providerAttemptColumns);
  assert.equal(
    baseline.MANIFEST_PATH,
    path.join(repoRoot, "artifacts", "adstudio", "evidence", "provider-runs-manifest.json"),
  );
});
