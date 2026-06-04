import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assembleImagePrompt,
  assembleMetaCopyPrompt,
  renderTemplate,
} from "../src/lib/operator/prompts/assemble-prompt.ts";
import {
  getActivePromptBundle,
  getActivePromptSection,
  PROMPT_FALLBACKS,
  type PromptKey,
} from "../src/lib/operator/prompts/prompt-registry.ts";
import { buildRedactedProviderRunInput, redactRecord } from "../src/lib/operator/prompts/redact-prompt-run.ts";

const migrationSql = readFileSync("supabase/migrations/202606040002_prompt_governance.sql", "utf8");

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

test("prompt governance migration adds active lifecycle and service-only RPC promotion", () => {
  assert.match(migrationSql, /add column if not exists status text not null default 'draft'/i);
  assert.match(migrationSql, /check \(status in \('draft', 'active', 'archived'\)\)/i);
  assert.match(migrationSql, /where status = 'active' and workspace_id is null/i);
  assert.match(migrationSql, /create or replace function public\.promote_global_prompt_version/i);
  assert.match(migrationSql, /create or replace function public\.rollback_global_prompt_version/i);
  assert.match(migrationSql, /revoke all on function public\.promote_global_prompt_version/i);
  assert.match(migrationSql, /grant execute on function public\.rollback_global_prompt_version.*to service_role/i);
});

test("active prompt lookup falls back to bundled prompt when no service client is available", async () => {
  const section = await getActivePromptSection("adstudio.copy.system", PROMPT_FALLBACKS["adstudio.copy.system"], null);

  assert.equal(section.source, "fallback");
  assert.equal(section.version, 0);
  assert.match(section.body, /Australian residential real-estate/);
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
    prompt,
    input: {
      prompt: "Call Steve on 0400 000 000 and use test@example.com.",
      referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.equal(serialized.includes(prompt.fullPrompt), false);
  assert.equal(serialized.includes("aW1hZ2U="), false);
  assert.equal(serialized.includes("test@example.com"), false);
  assert.equal(serialized.includes("0400 000 000"), false);
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
