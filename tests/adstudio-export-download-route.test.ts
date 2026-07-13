import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = "src/app/api/adstudio/export-packages/[id]/download/route.ts";

test("download route reloads the authoritative workspace campaign before reading client export data", () => {
  const route = readFileSync(routePath, "utf8");
  const authoritativeLoad = route.indexOf("loadAdStudioCampaignPack(");
  const clientBodyRead = route.indexOf("request.json()");

  assert.match(route, /loadAdStudioCampaignPack\(\s*access\.supabase,\s*access\.access\.workspaceId,\s*id,?\s*\)/);
  assert.ok(authoritativeLoad >= 0, "authoritative campaign load must exist");
  assert.ok(clientBodyRead < 0 || authoritativeLoad < clientBodyRead, "campaign load must precede client body handling");
  assert.match(route, /code:\s*"campaign_not_found"/);
  assert.match(route, /buildAdStudioExportPackage\(authoritativePack,/);
  assert.doesNotMatch(route, /buildAdStudioExportPackage\(body\.campaignPack,/);
});

test("download route rejects authoritative flat clones with a stable response before packaging", () => {
  const route = readFileSync(routePath, "utf8");
  const cloneGuard = route.indexOf('code: "flat_clone_export_not_ready"');
  const packageBuild = route.indexOf("buildAdStudioExportPackage(authoritativePack,");

  assert.match(route, /creative\.canvas\.objects\.length === 1/);
  assert.match(route, /creative\.canvas\.objects\[0\]\?\.objectId === "template_clone_image"/);
  assert.match(route, /code:\s*"flat_clone_export_not_ready"/);
  assert.match(
    route,
    /error:\s*"This AI-designed ad cannot be exported until its approved revision files are ready\."/,
  );
  assert.match(route, /status:\s*409/);
  assert.ok(cloneGuard >= 0 && cloneGuard < packageBuild, "flat clones must be rejected before packaging");
});

test("download route rejects malformed legacy export data explicitly", () => {
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /if \(!Array\.isArray\(body\?\.creativeRenders\)\)/);
  assert.match(route, /code:\s*"invalid_export_payload"/);
  assert.match(route, /status:\s*400/);
});
