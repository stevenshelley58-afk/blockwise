import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractTemplateFromImage } from "../src/lib/ad-template-library/creative-dna.ts";
import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";
import { SAMPLE_IMPORT_SCORER_VERSION, buildSampleTemplateCandidate, funnelStageForArchetype } from "../src/lib/ad-template-library/sample-template.ts";
import { createDeterministicTextProvider } from "../src/lib/adstudio/providers.ts";

const validSkeleton = {
  version: 1 as const,
  archetype: "just_sold" as const,
  shot: { type: "exterior_hero", lighting: "golden hour", mood: "aspirational" },
  composition: {
    focal_point: "facade",
    horizon: "low" as const,
    image_frames: [
      { id: "p", role: "primary" as const, x: 0, y: 0, width: 1, height: 0.7, formats: ["1:1" as const, "4:5" as const] },
      { id: "h", role: "agent_headshot" as const, x: 0.72, y: 0.72, width: 0.2, height: 0.2 },
    ],
    copy_safe_zones: [{ id: "z", x: 0.06, y: 0.74, width: 0.6, height: 0.2, priority: "primary" as const }],
  },
  color: { palette: ["#123456"], overlay: "bottom scrim", contrast: "high" as const },
  text_system: { headline_zone: "lower_left", badge: "sold_ribbon", cta_style: "solid_pill" },
  copy: { hook_style: "statement", headline_pattern: "Just sold in {suburb}", cta: "Request update" },
  variables: ["suburb"],
  confidence: 88,
};

test("buildSampleTemplateCandidate maps an extracted skeleton to a draft candidate", () => {
  const skeleton = creativeSkeletonSchema.parse(validSkeleton);
  const candidate = buildSampleTemplateCandidate({ skeleton, templateKey: "sample_abc123" });

  assert.equal(candidate.status, "draft");
  assert.equal(candidate.template_key, "sample_abc123");
  assert.equal(candidate.adstudio_template_id, "sample_abc123");
  assert.equal(candidate.category, "just_sold");
  assert.equal(candidate.scorer_version, SAMPLE_IMPORT_SCORER_VERSION);
  assert.equal(candidate.hook_style, "statement");
  assert.equal(candidate.headline, "Just sold in {suburb}");
  assert.equal(candidate.cta, "Request update");
  assert.deepEqual(candidate.variables, ["suburb"]);
  assert.equal(candidate.evidence_score, 88);
  assert.equal(candidate.funnel_stage, "consideration");
  // Format set comes from the frames that declared formats (primary), deduped.
  assert.deepEqual(candidate.format, ["1:1", "4:5"]);
  // The full extracted skeleton (incl. image_frames) carries through to the row.
  assert.equal(candidate.creative_skeleton.composition.image_frames?.length, 2);
});

test("buildSampleTemplateCandidate falls back to default formats when frames declare none", () => {
  const skeleton = creativeSkeletonSchema.parse({
    ...validSkeleton,
    composition: {
      ...validSkeleton.composition,
      image_frames: [{ id: "p", role: "primary" as const, x: 0, y: 0, width: 1, height: 1 }],
    },
  });
  const candidate = buildSampleTemplateCandidate({ skeleton, templateKey: "sample_x" });
  assert.deepEqual(candidate.format, ["9:16", "4:5", "1:1"]);
});

test("funnelStageForArchetype maps appraisal to conversion and listing to awareness", () => {
  assert.equal(funnelStageForArchetype("appraisal"), "conversion");
  assert.equal(funnelStageForArchetype("listing_hero"), "awareness");
  assert.equal(funnelStageForArchetype("coming_soon"), "awareness");
  assert.equal(funnelStageForArchetype("market_stat"), "consideration");
});

test("extractTemplateFromImage runs the shared extractor and tags the source", async () => {
  const provider = {
    ...createDeterministicTextProvider(),
    generate: async () => ({
      json: validSkeleton,
      rawText: JSON.stringify(validSkeleton),
      usage: {},
      providerMetadata: { model: "vision-extract-test" },
    }),
  };

  const result = await extractTemplateFromImage({
    asset: { imageUrl: "data:image/png;base64,AAAA", imageHash: "sha256:abc" },
    source: "sample_import",
    provider,
  });

  assert.equal(result.source, "sample_import");
  assert.equal(result.skeleton.archetype, "just_sold");
  assert.equal(result.skeleton.composition.image_frames?.length, 2);
});

test("template_sample_imports migration creates an RLS, service-owned table", () => {
  const sql = readFileSync("supabase/migrations/202606200009_template_sample_imports.sql", "utf8");
  assert.match(sql, /create table if not exists research\.template_sample_imports/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /status in \('draft', 'approved', 'archived'\)/);
  assert.match(sql, /template_sample_imports_operator_select/);
  assert.match(sql, /for insert to authenticated with check \(false\)/);
  assert.match(sql, /for update to authenticated using \(false\) with check \(false\)/);
  assert.match(sql, /for delete to authenticated using \(false\)/);
});
