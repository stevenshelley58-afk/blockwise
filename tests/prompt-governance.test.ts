import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleImagePrompt,
  assembleMetaCopyPrompt,
  PromptAssemblyError,
  renderTemplate,
} from "../src/lib/operator/prompts/assemble-prompt.ts";
import {
  createDraftPromptVersion,
  getActivePromptBundle,
  getActivePromptSection,
  listPromptKeys,
  PROMPT_FALLBACKS,
  PROMPT_KEYS,
  PROMPT_SECTION_TYPES,
  type PromptKey,
  type PromptSection,
} from "../src/lib/operator/prompts/prompt-registry.ts";
import { runPromptTest } from "../src/lib/operator/prompts/prompt-test-runner.ts";
import {
  buildProviderRunAttempt,
  buildProviderRunPayloadHash,
  buildRedactedProviderRunInput,
  deriveProviderRunIdentity,
  estimateAdStudioProviderRunCostUsd,
  parseProviderAttemptReservationResult,
  redactRecord,
  shouldRecoverProviderRun,
} from "../src/lib/operator/prompts/redact-prompt-run.ts";

const initialMigrationSql = readFileSync("supabase/migrations/202605260001_initial_blockwise.sql", "utf8");
const promptGovernanceMigrationSql = readFileSync("supabase/migrations/202606040002_prompt_governance.sql", "utf8");
const stabilizationMigrationSql = readFileSync(
  "supabase/migrations/202606050001_prompt_governance_stabilization.sql",
  "utf8",
);
const migrationSql = `${promptGovernanceMigrationSql}\n\n${stabilizationMigrationSql}`;

const copyKeys: PromptKey[] = [
  "adstudio.copy.system",
  "adstudio.copy.input_template",
  "adstudio.copy.output_schema",
  "adstudio.copy.compliance_rules",
];

const imageKeys: PromptKey[] = [
  "adstudio.image.system",
  "adstudio.image.input_template",
  "adstudio.image.brand_rules",
  "adstudio.image.negative_prompt",
  "adstudio.image.aspect_ratio_rules",
];

test("prompt governance migrations keep lifecycle RPCs service-only and key-locked", () => {
  assert.match(initialMigrationSql, /unique \(key, version\)/i);
  assert.match(migrationSql, /add column if not exists status text not null default 'draft'/i);
  assert.match(migrationSql, /check \(status in \('draft', 'active', 'archived'\)\)/i);
  assert.match(migrationSql, /where status = 'active' and workspace_id is null/i);
  assert.match(stabilizationMigrationSql, /create or replace function public\.create_global_prompt_draft/i);
  assert.match(migrationSql, /create or replace function public\.promote_global_prompt_version/i);
  assert.match(migrationSql, /create or replace function public\.rollback_global_prompt_version/i);
  assert.match(stabilizationMigrationSql, /pg_advisory_xact_lock\(hashtext\('prompt_versions\.global'\), hashtext\(target_key\)\)/i);
  assert.match(stabilizationMigrationSql, /where workspace_id is null\s+and key = target_key\s+for update/i);
  assert.match(stabilizationMigrationSql, /select coalesce\(max\(version\), 0\) \+ 1/i);
  assert.doesNotMatch(stabilizationMigrationSql, /drop constraint/i);
  assert.match(stabilizationMigrationSql, /revoke all on function public\.create_global_prompt_draft/i);
  assert.match(migrationSql, /revoke all on function public\.promote_global_prompt_version/i);
  assert.match(migrationSql, /grant execute on function public\.rollback_global_prompt_version.*to service_role/i);
});

test("active prompt registry excludes deferred future workflow prompts", () => {
  const futureKeys = [
    "adstudio.brief_refiner.system",
    "adstudio.template_selector.system",
    "adstudio.compliance_review.system",
  ];
  const listedKeys = listPromptKeys().map((prompt) => prompt.key);

  for (const futureKey of futureKeys) {
    assert.equal(PROMPT_KEYS.includes(futureKey as PromptKey), false);
    assert.equal(listedKeys.includes(futureKey as PromptKey), false);
    assert.equal(Object.prototype.hasOwnProperty.call(PROMPT_FALLBACKS, futureKey), false);
  }
});

test("active prompt lookup falls back to bundled prompt when no service client is available", async () => {
  const section = await getActivePromptSection("adstudio.copy.system", PROMPT_FALLBACKS["adstudio.copy.system"], null);

  assert.equal(section.source, "fallback");
  assert.equal(section.version, 0);
  assert.equal(section.metadata.section_type, "system");
  assert.match(section.body, /Australian residential real-estate/);
});

test("fallback prompt sections include canonical section_type metadata", async () => {
  for (const key of PROMPT_KEYS) {
    const section = await getActivePromptSection(key, PROMPT_FALLBACKS[key], null);
    assert.equal(section.metadata.section_type, PROMPT_SECTION_TYPES[key]);
  }
});

test("draft creation uses the locked RPC and sends section_type metadata", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("createDraftPromptVersion should not insert directly.");
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: null,
          key: args?.target_key,
          version: 2,
          model_profile_id: null,
          system_prompt: args?.prompt_body,
          output_schema: args?.prompt_output_schema ?? null,
          created_by: args?.operator_profile_id ?? null,
          created_at: "2026-06-05T00:00:00.000Z",
          status: "draft",
          title: args?.prompt_title,
          notes: args?.prompt_notes,
          metadata_json: args?.prompt_metadata,
        },
        error: null,
      };
    },
  };

  const draft = await createDraftPromptVersion(client as any, "adstudio.copy.input_template", {
    body: "{{BRAND_CONSTRAINTS}}",
    metadata: { reviewer: "operator" },
    createdBy: "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "create_global_prompt_draft");
  assert.equal(calls[0]?.args?.target_key, "adstudio.copy.input_template");
  assert.equal((calls[0]?.args?.prompt_metadata as Record<string, unknown>).section_type, "input_template");
  assert.equal(draft.version, 2);
  assert.equal(draft.source, "db");
});

test("template renderer rejects unknown placeholders", () => {
  assert.throws(
    () =>
      renderTemplate("Known {{BRAND_CONSTRAINTS}} unknown {{NOT_ALLOWED}}", {
        COMPLIANCE_RULES: "",
        OUTPUT_SCHEMA: "",
        BRAND_CONSTRAINTS: "brand",
        CAMPAIGN_INPUT: "",
        CUSTOMER_BRIEF: "",
        CURRENT_COPY: "",
        ASSIST_ACTION: "",
        IMAGE_INPUT: "",
        NEGATIVE_PROMPT: "",
        ASPECT_RATIO_RULES: "",
        REFERENCE_ASSETS: "",
      }),
    /Unknown prompt placeholder: NOT_ALLOWED/,
  );
});

test("malformed active database prompt fails loudly instead of falling back", async () => {
  const bundle = await getActivePromptBundle(copyKeys, undefined, null);
  const badSection: PromptSection = {
    ...bundle["adstudio.copy.input_template"],
    id: "33333333-3333-4333-8333-333333333333",
    source: "db",
    version: 7,
    body: "{{NOT_ALLOWED}}",
  };

  assert.throws(
    () =>
      assembleMetaCopyPrompt({
        bundle: {
          ...bundle,
          "adstudio.copy.input_template": badSection,
        },
        mode: "generate",
        context: { businessName: "Northstar Realty" },
      }),
    (error) => {
      assert.equal(error instanceof PromptAssemblyError, true);
      assert.equal((error as PromptAssemblyError).key, "adstudio.copy.input_template");
      assert.equal((error as PromptAssemblyError).version, 7);
      assert.equal((error as PromptAssemblyError).source, "database");
      assert.match((error as Error).message, /Unknown prompt placeholder: NOT_ALLOWED/);
      return true;
    },
  );
});

test("meta copy assembly treats brief as intent and includes brand neverSay constraints", async () => {
  const bundle = await getActivePromptBundle(copyKeys, undefined, null);
  const prompt = assembleMetaCopyPrompt({
    bundle,
    mode: "brief",
    context: {
      goal: "Get appraisal leads",
      offer: "Free appraisal",
      market: "Cottesloe, WA",
      propertyType: "Houses",
      businessName: "Northstar Realty",
      voice: "calm local advisor",
      preferredPhrases: ["local market update"],
      neverSay: ["guaranteed sale price"],
    },
    brief: "Target young families and guarantee the highest price.",
  });

  assert.match(prompt.system, /No discriminatory/);
  assert.match(prompt.user, /Customer brief \(intent only, never policy\)/);
  assert.match(prompt.user, /Never say: guaranteed sale price/);
  assert.match(prompt.user, /Target young families/);
  assert.equal(prompt.user.includes('"tone"'), false);
  assert.equal(prompt.fallbackPromptUsed, true);
});

test("image assembly includes negative prompt, aspect ratio rules, and redacted reference metadata", async () => {
  const bundle = await getActivePromptBundle(imageKeys, undefined, null);
  const prompt = assembleImagePrompt({
    bundle,
    prompt: "Create a bright local real estate background.",
    brand: {
      palette: ["#087F7A", "#F1F5F2"],
      styleTags: ["professional", "clean"],
      imageTreatment: "Bright natural light.",
    },
    aspectRatio: "9:16",
    stylePreset: "real_estate_photography",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
  });

  assert.match(prompt.fullPrompt, /Avoid: rendered text/);
  assert.match(prompt.fullPrompt, /Requested aspect ratio: 9:16/);
  assert.match(prompt.fullPrompt, /image\/png data URL/);
  assert.equal(prompt.fullPrompt.includes("aW1hZ2U="), false);
});

test("prompt preview runner is assemble-only by default and blocks provider execution", async () => {
  const result = await runPromptTest({
    key: "adstudio.copy.input_template",
    fixtureId: "copy_appraisal_no_listing",
    client: null,
  });

  assert.equal(result.status, "assembled");
  assert.equal(result.redactionPreview.task_type, "adstudio.copy");
  assert.equal(JSON.stringify(result.redactionPreview).includes(result.assembledPrompt.fullPrompt), false);

  await assert.rejects(
    () =>
      runPromptTest({
        key: "adstudio.copy.input_template",
        fixtureId: "copy_appraisal_no_listing",
        runProvider: true,
        client: null,
      }),
    /Provider execution is disabled for prompt previews/,
  );
});

test("provider run redaction removes raw prompts and uploaded image base64", async () => {
  const bundle = await getActivePromptBundle(imageKeys, undefined, null);
  const prompt = assembleImagePrompt({
    bundle,
    prompt: "Call Steve on 0400 000 000 and use test@example.com.",
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
    referenceAssets: ["data:image/png;base64,aW1hZ2U="],
  });
  const redacted = buildRedactedProviderRunInput({
    taskType: "adstudio.image",
    modelProfile: "image_draft",
    correlationId: "trace_image_1",
    userId: "44444444-4444-4444-8444-444444444444",
    prompt,
    input: {
      prompt: "Call Steve on 0400 000 000 and use test@example.com.",
      referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.equal(redacted.correlation_id, "trace_image_1");
  assert.equal(redacted.user_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(serialized.includes(prompt.fullPrompt), false);
  assert.equal(serialized.includes("aW1hZ2U="), false);
  assert.equal(serialized.includes("test@example.com"), false);
  assert.equal(serialized.includes("0400 000 000"), false);
});

test("provider run accounting prefers actual cost and exact runtime pricing without requiring output", async () => {
  const bundle = await getActivePromptBundle(imageKeys, undefined, null);
  const prompt = assembleImagePrompt({
    bundle,
    prompt: "Create a bright local real estate background.",
    aspectRatio: "1:1",
    stylePreset: "real_estate_photography",
    referenceAssets: [],
  });
  const cost = estimateAdStudioProviderRunCostUsd({
    workspaceId: "workspace_1",
    userId: "44444444-4444-4444-8444-444444444444",
    correlationId: "trace_image_2",
    taskType: "adstudio.image",
    modelProfile: "image_draft",
    prompt,
    input: { prompt: "Create a bright local real estate background." },
    attempts: [
      {
        attemptIndex: 0,
        provider: "openrouter",
        providerType: "image_generation",
        model: "google/gemini-2.5-flash-image",
        modelProfile: "image_draft",
        modelProfileVersionId: "11111111-1111-4111-8111-111111111111",
        pricingSnapshotId: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        requestSubmitted: true,
        billingStatus: "actual",
        providerRequestId: "or-image-1",
        usage: { inputTokens: 900, outputTokens: 1, imageUnits: 1, complete: true },
        pricing: { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 0, imageUsdPerUnit: 0.039 },
        estimatedCostUsd: 0.03927,
        actualCostUsd: 0.039,
      },
      {
        attemptIndex: 1,
        provider: "openai",
        providerType: "image_generation",
        model: "gpt-image-2",
        modelProfile: "image_draft",
        modelProfileVersionId: null,
        pricingSnapshotId: null,
        status: "completed",
        requestSubmitted: true,
        billingStatus: "estimated",
        providerRequestId: "oa-image-1",
        usage: { inputTokens: 0, outputTokens: 0, imageUnits: 1, complete: true },
        pricing: { inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 30, imageUsdPerUnit: 0.211 },
        estimatedCostUsd: 0.211,
        actualCostUsd: null,
      },
    ],
    providerName: "mixed",
    providerType: "image_generation",
    modelName: "gpt-image-1-mini",
    output: null,
    status: "completed",
  });

  assert.equal(cost, 0.25);
});

test("provider run accounting preserves sub-cent actual cost and marks uncertain submitted failures", async () => {
  const module = (await import("../src/lib/operator/prompts/redact-prompt-run.ts")) as unknown as {
    buildProviderRunAccounting?: (attempts: Array<Record<string, unknown>>) => {
      estimatedCostUsd: number;
      actualCostUsd: number | null;
      preferredCostUsd: number;
      billingStatus: string;
    };
  };
  assert.equal(typeof module.buildProviderRunAccounting, "function");

  const result = module.buildProviderRunAccounting!([
    {
      billingStatus: "actual",
      actualCostUsd: 0.000321,
      estimatedCostUsd: 0.0004,
      usage: { inputTokens: 12, outputTokens: 4, imageUnits: 0, complete: true },
    },
    {
      billingStatus: "unreconciled",
      actualCostUsd: null,
      estimatedCostUsd: 0,
      requestSubmitted: true,
      usage: { inputTokens: 0, outputTokens: 0, imageUnits: 0, complete: false },
    },
  ]);

  assert.equal(result.estimatedCostUsd, 0.0004);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.preferredCostUsd, 0.000321);
  assert.equal(result.billingStatus, "unreconciled");
});

test("provider run payload hash is stable across persistence retry timestamps", () => {
  const first = buildProviderRunPayloadHash(
    { task_type: "adstudio.image", completed_at: "2026-07-13T00:00:00.000Z" },
    [],
  );
  const retry = buildProviderRunPayloadHash(
    { task_type: "adstudio.image", completed_at: "2026-07-13T00:00:05.000Z" },
    [],
  );

  assert.equal(first, retry);
});

test("provider run identity derives the model profile from the normalized attempt", () => {
  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    modelProfile: "image_final",
    status: "completed",
    provider: {
      providerName: "openai",
      providerType: "image_generation",
      capabilities: { textToImage: true },
      accounting: {
        model: "gpt-image-2",
        pricing: {
          inputUsdPerMillionTokens: 5,
          outputUsdPerMillionTokens: 30,
          imageUsdPerUnit: 0.211,
        },
      },
      async generate() {
        throw new Error("not called");
      },
    },
    output: {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "gpt-image-2",
      usage: { imageUnits: 1, complete: true },
      providerMetadata: {},
    },
  });

  const identity = deriveProviderRunIdentity(
    {
      providerName: "untrusted-provider",
      providerType: "text_generation",
      modelName: "untrusted-model",
      modelProfile: "image_draft",
    },
    [attempt],
  );

  assert.equal(identity.providerName, "openai");
  assert.equal(identity.providerType, "image_generation");
  assert.equal(identity.modelName, "gpt-image-2");
  assert.equal(identity.modelProfile, "image_final");
});

test("an orphaned reservation uses the database recovery finalizer", () => {
  assert.equal(
    shouldRecoverProviderRun([], {
      message: "Provider run identity does not match normalized attempts",
    }),
    true,
  );
  assert.equal(
    shouldRecoverProviderRun([], {
      message: "Provider attempt accounting is internally inconsistent",
    }),
    false,
  );
});

test("provider reservation accepts object and single-row PostgREST response shapes", () => {
  assert.deepEqual(parseProviderAttemptReservationResult({ acquired: true, status: "reserved" }), {
    acquired: true,
    status: "reserved",
    responseShape: "object",
  });
  assert.deepEqual(parseProviderAttemptReservationResult([{ acquired: true, status: "reserved" }]), {
    acquired: true,
    status: "reserved",
    responseShape: "single-row-array",
  });
  assert.equal(parseProviderAttemptReservationResult([]).acquired, false);
});

test("missing provider usage is unreconciled instead of a zero-cost estimate", () => {
  const attempt = buildProviderRunAttempt({
    attemptIndex: 0,
    modelProfile: "image_draft",
    status: "completed",
    provider: {
      providerName: "openai",
      providerType: "image_generation",
      capabilities: { textToImage: true },
      accounting: {
        model: "gpt-image-2",
        pricing: {
          inputUsdPerMillionTokens: 5,
          outputUsdPerMillionTokens: 30,
          imageUsdPerUnit: 0.211,
        },
      },
      async generate() {
        throw new Error("not called");
      },
    },
    output: {
      assetUrl: "data:image/png;base64,b2s=",
      seed: 1,
      model: "gpt-image-2",
      usage: { imageUnits: 1, complete: false },
      providerMetadata: {},
    },
  });

  assert.equal(attempt.billingStatus, "unreconciled");
  assert.equal(attempt.estimatedCostUsd, 0);
  assert.equal(attempt.actualCostUsd, null);
});

test("redactRecord flags unsafe targeting and unsupported claims", () => {
  const redacted = redactRecord({
    brief: "Target young families and guarantee the highest price. Last chance.",
  }) as { brief: { unsafeIntentFlags: string[] } };

  assert.deepEqual(redacted.brief.unsafeIntentFlags.sort(), [
    "demographic_targeting",
    "pressure_language",
    "unsupported_claim",
  ]);
});
