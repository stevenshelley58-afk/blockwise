import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("old ad and template creation endpoints stay deleted", () => {
  for (const path of [
    "src/app/api/adstudio/generate-clone/route.ts",
    "src/app/api/adstudio/generate-options/route.ts",
    "src/app/api/adstudio/template-library/route.ts",
    "src/app/api/adstudio/template-photo-prep/route.ts",
    "src/app/api/adstudio/creatives/[id]/enhance/route.ts",
    "src/lib/adstudio/template-brief.ts",
    "src/lib/adstudio/generator.ts",
    "src/lib/adstudio/creative-design-json.ts",
    "src/lib/adstudio/creative-design-builder.ts",
    "src/lib/adstudio/creative-svg.ts",
    "src/lib/adstudio/demo-data.ts",
    "src/lib/adstudio/campaign-clone.ts",
    "src/components/adstudio/canvas/fabric-ad-editor.tsx",
    "src/components/adstudio/canvas/browser-creative-renderer.ts",
    "src/components/adstudio/angles.ts",
    "src/app/api/adstudio/campaigns/[id]/duplicate/route.ts",
  ]) assert.equal(existsSync(path), false, path);
});

test("campaign creation has one template clone pipeline", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");
  assert.match(route, /runTemplateCampaignGeneration/);
  assert.doesNotMatch(route, /generateAdStudioCampaignPack\(\{|generate-options|template-photo-prep/);
  assert.match(generation, /fast:\s*"image_draft"/);
  assert.match(generation, /high:\s*"image_final"/);
  assert.match(generation, /resolveCloneProviders\(quality/);
  assert.doesNotMatch(generation, /CloneTier|tier:/);

  const client = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  assert.equal((client.match(/fetch\("\/api\/adstudio\/campaigns"/g) ?? []).length, 1);
  assert.match(client, /firstAd: input/);
  assert.doesNotMatch(client, /variantCount|generateVariantsForAngle|onRegenerate/);
});

test("campaign generation uses Vercel inline with delayed VPS recovery", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const worker = readFileSync("worker/index.ts", "utf8");

  assert.doesNotMatch(route, /@trigger\.dev|triggerTemplateGeneration|TRIGGER_SECRET_KEY/);
  assert.match(route, /await runTemplateCampaignGeneration/);
  assert.match(route, /kind: "adstudio\.generate\.template"/);
  assert.match(route, /GENERATION_RECOVERY_DELAY_MS/);
  assert.match(route, /cancelQueuedJob\(\{/);
  assert.doesNotMatch(route, /service\.rpc\("complete_job"/);
  assert.match(route, /expectedCampaignId/);
  assert.match(route, /correlationId/);
  assert.match(worker, /expectedCampaignId: stored\.expectedCampaignId/);

  const pipeline = generation.slice(generation.indexOf("export async function runTemplateCampaignGeneration"));
  assert.ok(
    pipeline.indexOf("resumePersistedTemplateCampaign") < pipeline.indexOf("resolveCloneProviders"),
    "a persisted Feed checkpoint must be resumed before any image provider is resolved",
  );
});

test("the one full-ad request consumes sample, assets, and exact copy", () => {
  const source = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");
  assert.match(source, /Reference image 1 is the ad design to clone/);
  assert.match(source, /Use these exact visible text values and no others/);
  assert.match(source, /referenceAssets: \[referenceImage, \.\.\.suppliedImages\.map/);
  assert.doesNotMatch(source, /fabricJson|layout archetype|template version/i);
});

test("editing is available only on the finished image", () => {
  const builder = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");
  const editor = readFileSync("src/components/adstudio/canvas/in-place-ad-editor.tsx", "utf8");
  const editClient = readFileSync("src/components/adstudio/canvas/creative-edit-client.ts", "utf8");
  assert.match(builder, /Reference image 1 is an existing finished ad/);
  assert.match(builder, /Keep every other pixel unchanged/);
  assert.match(editClient, /\/api\/adstudio\/creatives\/\$\{creative\.creativeId\}\/edit/);
  assert.match(editor, /renderHistory/);
});

test("the retired image profile stays removed", () => {
  const retiredKey = ["image", "generative"].join("_");
  const retiredLabel = ["Image", "generative"].join(" ");
  const createMoreLabel = ["Create", "more", "options"].join(" ");
  const retiredMigration = `supabase/migrations/202606200001_${retiredKey}_and_best_defaults.sql`;
  const currentMigration = readFileSync("supabase/migrations/202606200001_best_model_defaults.sql", "utf8");
  const cleanupMigration = readFileSync("supabase/migrations/202607140001_remove_retired_image_profile.sql", "utf8");

  assert.equal(existsSync(retiredMigration), false);
  assert.doesNotMatch(currentMigration, new RegExp(`${retiredKey}|${retiredLabel}|${createMoreLabel}`, "i"));
  assert.match(cleanupMigration, /prompt_reference_count/);
  assert.match(cleanupMigration, /run_reference_count/);
  assert.match(cleanupMigration, /delete from public\.model_profiles/);
});
