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
  "status",
  "cost_estimate",
  "usage_json",
  "ai_run_id",
  "ai_usage_ledger_id",
];

type QueryCall = {
  table: string;
  columns?: string;
  filters: Array<{ operator: string; column?: string; value: unknown }>;
  orders: Array<{ column: string; options: unknown }>;
  limit?: number;
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
    status: "completed",
    cost_estimate: "1.2500",
    usage_json: { inputTokens: 0, outputTokens: 0, imageUnits: 1, complete: true },
    ai_run_id: "ai-run-alpha",
    ai_usage_ledger_id: "ledger-alpha",
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
    "image_generative",
    "structured_json",
    "vision_classification",
  ]);
  const draft = evidence.find((profile: { profileKey: string }) => profile.profileKey === "image_draft");
  assert.equal(draft.source, "persisted");
  assert.equal(draft.primary.provider, "openrouter");
  assert.equal(draft.primary.model, "google/gemini-2.5-flash-image");
  assert.match(draft.activeVersionIdSha256, /^[a-f0-9]{64}$/);
  assert.equal(draft.fallbacks[0].model, "google/gemini-3.1-flash-image-preview");

  const final = evidence.find((profile: { profileKey: string }) => profile.profileKey === "image_final");
  assert.equal(final.source, "default");
  assert.equal(final.primary.model, "gpt-image-2");
  assert.equal(final.activeVersionIdSha256, null);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(rawVersionId));
});

test("profile-version query freezes runtime resolution at the same exclusive cutoff", async () => {
  const supabase = queuedSupabase({ model_profile_versions: [[{
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
  }]] });
  const windowEnd = "2026-07-13T00:00:00.000Z";

  await baseline.loadActiveProfileVersionRows({ supabase: supabase as never, windowEnd });

  const [call] = supabase.calls;
  assert.equal(call.table, "model_profile_versions");
  assert.ok(call.filters.some((filter) => filter.operator === "lt" && filter.column === "active_from" && filter.value === windowEnd));
  assert.equal(call.filters.some((filter) => filter.operator === "or" && String(filter.value).includes(`active_to.gte.${windowEnd}`)), true);
  assert.deepEqual(call.orders.map(({ column }) => column), ["active_from", "id"]);
});

test("manifest contains exact private rows and complete public-safe hashes and accounting aggregates", () => {
  const rows = [
    providerRun(),
    providerRun({
      id: "run-beta",
      created_at: "2026-07-12T02:00:00.000Z",
      provider_name: "openrouter",
      provider_type: "text_generation",
      model_name: "openai/gpt-5.5",
      model_profile: "structured_json",
      task_type: "adstudio.copy",
      status: "failed",
      cost_estimate: "0.0000",
      usage_json: { inputTokens: 5, outputTokens: 0, complete: true },
      ai_run_id: null,
      ai_usage_ledger_id: "ledger-beta",
    }),
    providerRun({
      id: "run-gamma",
      workspace_id: "workspace-beta",
      created_at: "2026-07-12T03:00:00.000Z",
      provider_name: "deterministic_local",
      provider_type: "local",
      model_name: null,
      model_profile: null,
      task_type: "unknown",
      status: "completed",
      cost_estimate: "-0.1000",
      usage_json: {},
      ai_run_id: "ai-run-gamma",
      ai_usage_ledger_id: null,
    }),
  ];
  const modelProfiles = baseline.resolveModelProfileEvidence([], resolveEffectiveModelProfile);
  const manifest = baseline.buildProviderBaselineManifest({
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    capturedAtStart: "2026-07-13T00:00:00.000Z",
    capturedAtEnd: "2026-07-13T00:00:05.000Z",
    windowEnd: "2026-07-13T00:00:00.000Z",
    workspaceIds: ["workspace-beta", "workspace-alpha"],
    firstPassRows: rows,
    secondPassRows: rows,
    modelProfiles,
  });

  assert.equal(manifest.schema, "adstudio-provider-run-baseline/v1");
  assert.match(manifest.schemaSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.capture.window.startInclusive, "1970-01-01T00:00:00.000Z");
  assert.equal(manifest.capture.window.endExclusive, "2026-07-13T00:00:00.000Z");
  assert.match(manifest.query.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.source.commit, "f".repeat(40));
  assert.match(manifest.source.commitSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.source.toolSha256, "a".repeat(64));
  assert.equal(manifest.drift.detected, false);
  assert.equal(manifest.drift.firstPassSha256, manifest.drift.secondPassSha256);
  assert.equal(manifest.acceptanceEligible, true);
  assert.equal(manifest.publicSummary.totalRuns, 3);
  assert.match(manifest.publicSummary.workspaceIdSetSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.publicSummary.globalRunIdSetSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.publicSummary.workspaces.map((workspace: { runCount: number }) => workspace.runCount), [2, 1]);
  assert.equal(manifest.publicSummary.workspaces.every((workspace: { pseudonym: string }) => /^workspace-[a-f0-9]{16}$/.test(workspace.pseudonym)), true);
  assert.equal(manifest.publicSummary.cost.positive.count, 1);
  assert.equal(manifest.publicSummary.cost.positive.sum, "1.25");
  assert.equal(manifest.publicSummary.cost.zero.count, 1);
  assert.equal(manifest.publicSummary.cost.zero.sum, "0");
  assert.equal(manifest.publicSummary.cost.negative.count, 1);
  assert.equal(manifest.publicSummary.cost.negative.sum, "-0.1");
  assert.equal(manifest.publicSummary.anomalies.nonLocalTerminalNonZeroUsageZeroCostCount, 1);
  assert.equal(manifest.publicSummary.anomalies.missingOrAllZeroUsageCount, 1);
  assert.deepEqual(manifest.publicSummary.links.aiRun, { linkedCount: 2, missingCount: 1 });
  assert.deepEqual(manifest.publicSummary.links.aiUsageLedger, { linkedCount: 2, missingCount: 1 });
  assert.equal(manifest.publicSummary.dimensionQuality.modelProfile.nullCount, 1);
  assert.equal(manifest.publicSummary.dimensionQuality.taskType.unknownCount, 1);
  assert.ok(manifest.publicSummary.grouped.taskType.some((group: { value: string; count: number }) => group.value === "adstudio.image" && group.count === 1));
  assert.ok(manifest.publicSummary.grouped.providerModel.some((group: { providerName: string; modelName: string; count: number }) => group.providerName === "openai" && group.modelName === "gpt-image-2" && group.count === 1));
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);

  assert.deepEqual(manifest.privateEvidence.workspaces.map((workspace: { workspaceId: string }) => workspace.workspaceId), [
    "workspace-alpha",
    "workspace-beta",
  ]);
  assert.deepEqual(Object.keys(manifest.privateEvidence.workspaces[0].rows[0]), providerRunColumns);
  assert.equal(JSON.stringify(manifest.privateEvidence).includes("workspace-alpha"), true);
  assert.equal(JSON.stringify(manifest.publicSummary).includes("workspace-alpha"), false);
  assert.equal(JSON.stringify(manifest.publicSummary).includes("run-alpha"), false);
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
  const source = "export const evidenceVersion = 1;\n";
  await writeFile(toolPath, source, "utf8");
  runGit(root, ["add", "provider-baseline.mjs"]);
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
  assert.match(source, /snapshot-legacy-creatives\.mjs/);
  assert.doesNotMatch(source, /\.from\([^)]*\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(source, /\.(?:rpc|upload|remove)\s*\(/);
  assert.doesNotMatch(source, /input_json|output_json|error_json|correlation_id|mutation_id|payload_hash|provider_request|outbox/i);
  assert.doesNotMatch(source, /generateImage|createTextProvider|fetch\s*\(/i);
  assert.deepEqual(baseline.PROVIDER_RUN_COLUMNS, providerRunColumns);
  assert.equal(
    baseline.MANIFEST_PATH,
    path.join(repoRoot, "artifacts", "adstudio", "evidence", "provider-runs-manifest.json"),
  );
});
