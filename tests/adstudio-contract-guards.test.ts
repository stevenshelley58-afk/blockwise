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
    "src/components/adstudio/canvas/fabric-ad-editor.tsx",
  ]) assert.equal(existsSync(path), false, path);
});

test("campaign creation has one template clone pipeline", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");
  assert.match(route, /runTemplateCampaignGeneration/);
  assert.doesNotMatch(route, /generateAdStudioCampaignPack\(\{|generate-options|template-photo-prep/);
  assert.match(generation, /CLONE_MODEL_PROFILE = "image_final"/);
  assert.doesNotMatch(generation, /image_draft|CloneTier|tier:/);
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
  assert.match(builder, /Reference image 1 is an existing finished ad/);
  assert.match(builder, /Keep every other pixel unchanged/);
  assert.match(editor, /\/api\/adstudio\/creatives\/\$\{creative\.creativeId\}\/edit/);
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
