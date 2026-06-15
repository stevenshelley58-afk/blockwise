import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = () => readFileSync("src/app/api/adstudio/repair-image/route.ts", "utf8");

test("repair-image route resolves source images inside the active workspace", () => {
  const source = routeSource();

  assert.match(source, /resolveAdStudioImageForModel\(\s*context\.supabase,\s*context\.access\.workspaceId,\s*body\.sourceImage/s);
  assert.match(source, /Source image could not be read for auto fit/);
  assert.match(source, /\.from\("adstudio_brand_kits"\)[\s\S]*\.eq\("workspace_id", workspaceId\)[\s\S]*\.eq\("id", brandKitId\)/);
});

test("repair-image route stores repaired assets with provenance metadata", () => {
  const source = routeSource();

  assert.match(source, /\.from\("workspace-artifacts"\)[\s\S]*\.upload\(storagePath, decoded\.bytes/);
  assert.match(source, /\.from\("adstudio_brand_assets"\)\.insert\(\{/);
  assert.match(source, /workspace_id: input\.workspaceId/);
  assert.match(source, /brand_kit_id: input\.brandKitId/);
  assert.match(source, /asset_type: "listing_image"/);
  assert.match(source, /metadata_json: repairAssetMetadata\(\{/);
  assert.match(source, /targetFormat: input\.format/);
  assert.match(source, /model: input\.model/);
});

test("repair-image route rejects invalid repair formats before provider calls", () => {
  const source = routeSource();
  const validationBlock = source.slice(source.indexOf("let body:"), source.indexOf("if (!body.brandKitId)"));

  assert.match(validationBlock, /validateImageRepairRequest\(await readJsonBody<ImageRepairRequest>\(request\)\)/);
  assert.match(validationBlock, /return errorResponse\(error, 400\)/);
  assert.doesNotMatch(validationBlock, /buildRepairProviders\(/);
});

test("repair-image route uses reference-aware provider fallback and records failures", () => {
  const source = routeSource();

  assert.match(source, /modelCandidateAttempts\(profile\)\.map\(\(candidate\) => createImageProviderForCandidate\(candidate\)\)/);
  assert.match(source, /createOpenRouterImageProvider\(\)/);
  assert.match(source, /generateTruthPreservingRepair\(\{ imageInput, providers \}\)/);
  assert.match(source, /requiresReferenceAssets: true/);
  assert.match(source, /status: "failed"/);
  assert.match(source, /return errorResponse\(error, 502\)/);
});
