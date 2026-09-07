import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AdTemplate, LayoutLayer } from "../../packages/ad-template-contract/src/types.ts";
import { adTemplateSchema } from "../../packages/ad-template-contract/src/schema.ts";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";

const review = {
  process: "exact-clone" as const, sourcePlacement: "feed" as const, targetPlacement: "feed" as const, likenessThreshold: 9.8,
  comparator: { overall: 9.8, geometry: 9.8, colourEffects: 9.8, compositionCrop: 9.8, typography: 9.8, decision: "ready" as const },
  finalReviewers: [
    { id: "reviewer-one", route: "vision/one", overall: 9.6, minimum: 9.5, decision: "pass" as const },
    { id: "reviewer-two", route: "vision/two", overall: 9.7, minimum: 9.5, decision: "pass" as const },
  ], warnings: [], fontSubstitution: null,
};

function template(layer: LayoutLayer): AdTemplate {
  return {
    schema: "blockwise.ad-template", templateId: "review-flow-test", createdAt: "2026-09-05T00:00:00.000Z",
    feedLayout: { placement: "feed", safeZones: [], layers: [{ type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true }, layer] },
    storyLayout: { placement: "story", safeZones: [], layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }] },
    imageInputs: [], textInputs: [], semanticColours: { background: "#ffffff", primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff", mainText: "#111111", inverseText: "#ffffff" }, assets: {}, fonts: [],
    metadata: { title: "Review", description: "", gallerySamples: {}, metaCopyDefaults: { primaryText: ["Copy"], headlines: ["Headline"], descriptions: ["Description"], cta: "LEARN_MORE" }, aiWritingGuidance: { summary: "Write clearly", fields: {} }, publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: true, kind: "website", dependency: "destinationUrl" }, requiredCtaTypes: ["LEARN_MORE"] }, replacementAssets: [], realAssetRefs: [], generationReview: review },
  };
}

const baseLayer: LayoutLayer = { type: "vector", layerId: "shape", geometry: { x: 220, y: 260, width: 500, height: 320 }, shape: "rounded", colourRole: "primary", opacity: 1 };

test("exact-clone metadata is strict and requires two passing independent reviewers", () => {
  assert.equal(adTemplateSchema.safeParse(template(baseLayer)).success, true);
  const failed = template(baseLayer);
  failed.metadata.generationReview!.finalReviewers[1]!.id = "reviewer-one";
  assert.equal(adTemplateSchema.safeParse(failed).success, false);
  const sameRoute = template(baseLayer);
  sameRoute.metadata.generationReview!.finalReviewers[1]!.route = "vision/one";
  assert.equal(adTemplateSchema.safeParse(sameRoute).success, false);
});

test("saved renderer materially applies every fidelity appearance field", async () => {
  const baseline = (await renderPlacement({ template: template(baseLayer), imageValues: {}, textValues: {}, colourMap: template(baseLayer).semanticColours }, "feed")).png;
  const variants: LayoutLayer[] = [
    { ...baseLayer, fill: { type: "linear_gradient", angleDegrees: 20, stops: [{ offset: 0, colourRole: "primary", opacity: 1 }, { offset: 1, colourRole: "accent", opacity: 1 }] } },
    { ...baseLayer, effects: { shadow: { colourRole: "mainText", opacity: .7, blur: 18, offsetX: 16, offsetY: 18 } } },
    { ...baseLayer, effects: { stroke: { colourRole: "accent", opacity: 1, width: 12 } } },
    { ...baseLayer, effects: { rotationDegrees: 17 } },
    { ...baseLayer, effects: { blendMode: "multiply" }, opacity: .65 },
    { ...baseLayer, cornerRadius: 96 },
    { ...baseLayer, opacity: .35 },
  ];
  for (const layer of variants) {
    const candidate = template(layer);
    const output = (await renderPlacement({ template: candidate, imageValues: {}, textValues: {}, colourMap: candidate.semanticColours }, "feed")).png;
    assert.equal(output.equals(baseline), false, `appearance field did not change render: ${JSON.stringify(layer)}`);
  }
});

test("review endpoint is run-bound, import stays quarantined, and product migration applies it", () => {
  const route = readFileSync("src/app/api/internal/adstudio/template-artifacts/[templateId]/review/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260905010000_ad_template_smoke_review.sql", "utf8");
  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8");
  assert.match(route, /adstudio\.templates\.review/);
  assert.match(route, /"smoke_test", "activate", "discard"/);
  assert.match(migration, /record_ad_template_smoke_test/);
  assert.match(migration, /library_smoke_test_run_id is distinct from p_review_run_id/);
  assert.ok(migration.indexOf("update public.ad_templates set") < migration.indexOf("add constraint ad_templates_active_review_check"));
  assert.match(migration, /library_status = 'quarantined',[\s\S]*library_review_run_id = null,[\s\S]*where library_status = 'active'/);
  assert.match(migration, /library_smoke_test_checks is not null[\s\S]*jsonb_typeof\(library_smoke_test_checks\) = 'object'/);
  assert.match(allowlist, /20260905010000_ad_template_smoke_review\.sql/);
});

test("customer view defaults to the complete Meta ad while artwork remains inspectable", () => {
  const detail = readFileSync("src/components/adstudio/template-detail-preview.tsx", "utf8");
  const editor = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
  const canvas = readFileSync("src/components/adstudio/editor/layered-canvas.tsx", "utf8");
  assert.match(detail, /useState<"meta" \| "artwork">\("meta"\)/);
  assert.match(detail, /FeedPreview/);
  assert.match(detail, /StoryPreview/);
  assert.match(editor, /useState<"design" \| "meta" \| "split">\("meta"\)/);
  assert.match(editor, /AI Copy Assist/);
  assert.match(editor, /destinationUrl: state\.destinationUrl/);
  for (const field of ["rotationDegrees", "blendMode", "shadow", "stroke", "Gradient", "cornerRadius", "opacity"]) assert.match(canvas, new RegExp(field));
});
