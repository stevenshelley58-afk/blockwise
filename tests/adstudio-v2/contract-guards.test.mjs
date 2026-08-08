// §14 v2 contract guards: one template contract, one renderer, no image
// model reachable from any v2 customer route. The v1 assertions in
// tests/adstudio-contract-guards.test.ts stay until Track H rewrites them
// with the v1 pipeline.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { resolveTemplateAssetPath } from "../../src/lib/adstudio/v2/render/assets.ts";

const read = (p) => readFileSync(p, "utf8");

test("normal production builds run the v2 template evidence gate before Next compiles", () => {
  const scripts = JSON.parse(read("package.json")).scripts;

  assert.equal(scripts.prebuild, "node scripts/verify/adstudio-templates-v2.mjs");
  assert.equal(scripts.build, "next build");
  assert.equal(scripts.postbuild, "node scripts/verify/adstudio-function-traces.mjs");
});

// Only real imports count — comments mentioning old modules must not trip
// the law. Matches import statements, dynamic imports and require() calls.
const IMAGE_MODEL_IMPORT = /(^|[^/\w])(import[\s{]|from\s|require\(|await import\()[^\n]*(ai-providers|clone-generation|reference-clone)/m;

test("exactly one canonical v2 renderer (renderAdDocToPng defined once)", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && read(path).includes("export async function renderAdDocToPng")) {
        hits.push(path);
      }
    }
  };
  walk("src");
  assert.deepEqual(hits, [join("src", "lib", "adstudio", "v2", "render", "server.ts")]);
});

test("v2 customer + operator code never imports the image-model registry", () => {
  const offenders = [];
  const check = (path) => {
    const source = read(path);
    if (IMAGE_MODEL_IMPORT.test(source)) offenders.push(path);
  };
  const dirs = [
    "src/lib/adstudio/v2",
    "src/components/adstudio/editor",
    "src/components/adstudio/meta-frame",
  ];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) check(path);
    }
  };
  for (const dir of dirs) walk(dir);
  for (const route of [
    "src/app/api/adstudio/creatives/[id]/doc/route.ts",
    "src/app/api/dev/render-smoke/route.ts",
    "src/app/api/operator/template-studio/[id]/route.ts",
  ]) {
    if (existsSync(route)) check(route);
  }
  assert.deepEqual(offenders, [], `image model reachable from v2 paths: ${offenders.join(", ")}`);
});

test("v2 generation is flag-gated and zero-credit at the campaigns route", () => {
  const route = read("src/app/api/adstudio/campaigns/route.ts");
  assert.match(route, /adstudioTemplatesV2Enabled\(\)/);
  assert.match(route, /resolveReadyTemplateV2/);
  assert.match(route, /v2_renders_cost_zero/);
  assert.match(route, /const persisted = await persistAdStudioCampaignPack/);
  assert.match(route, /if \(persisted\.error\)/);
  assert.match(route, /if \(v2Enabled && !v2Template\)/);
  assert.ok(
    route.indexOf("if (v2Enabled && !v2Template)") < route.indexOf("const creditGate = await reserveAdStudioGenerationCredits"),
    "a QA or unknown v2 template must fail before credits or the legacy generator",
  );
});

test("the campaigns route forwards every declared customer input to v2 generation", () => {
  const route = read("src/app/api/adstudio/campaigns/route.ts");
  const v2Call = route.slice(route.indexOf("const v2 = await generateV2Campaign({"), route.indexOf("const persisted = await persistAdStudioCampaignPack"));
  assert.match(v2Call, /images:\s*body\.firstAd!\.imageDataUrls/);
  assert.match(v2Call, /text:\s*body\.firstAd!\.onImageCopy/);
});

test("the public v2 template endpoint fails closed for QA templates", () => {
  const route = read("src/app/api/adstudio/templates-v2/[id]/route.ts");
  assert.match(route, /resolveReadyTemplateV2/);
  assert.match(route, /loadTemplateV2ByHash/);
  assert.match(route, /requireAdStudioRequest/);
  assert.match(route, /\.eq\("workspace_id", context\.access\.workspaceId\)/);
  assert.match(route, /matchesAdDocTemplatePin/);
  assert.match(route, /creativeId/);
  assert.match(route, /redactTemplateV2ForCustomer/);
  assert.doesNotMatch(route, /loadTemplateV2\(/);
  assert.match(route, /if \(!template\) return NextResponse\.json\([^\n]+status: 404/);
});

test("source-derived plates and patches are unconditionally denied before session handling", () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /TEMPLATE_ASSET_PREFIX = "\/adstudio-templates\/"/);
  assert.match(proxy, /filename\.startsWith\("plate-"\)/);
  assert.match(proxy, /filename\.startsWith\("patch-"\)/);
  assert.match(proxy, /optimizedPath && isSourceDerivedTemplateAsset\(optimizedPath\)/);
  assert.match(proxy, /status: 404/);
  assert.match(proxy, /"\/_next\/image"/);
  assert.match(proxy, /"\/adstudio-templates\/:path\*"/);
  const sessionRefresh = proxy.indexOf("const session = await refreshSupabaseSession(request)");
  assert.ok(sessionRefresh > 0);
  assert.ok(proxy.indexOf("optimizedPath && isSourceDerivedTemplateAsset(optimizedPath)") < sessionRefresh);
  assert.ok(proxy.indexOf("isSourceDerivedTemplateAsset(pathname)") < sessionRefresh);
});

test("safe gallery samples stay public while source-derived bytes live only in the server tree", () => {
  const proxy = read("src/proxy.ts");
  assert.doesNotMatch(proxy, /filename\.startsWith\("sample/);
  assert.match(proxy, /isSourceDerivedTemplateAsset\(pathname\)/);

  const leaked = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^(?:plate|patch)-/.test(entry.name)) leaked.push(path);
    }
  };
  walk("public/adstudio-templates");
  assert.deepEqual(leaked, []);
  assert.ok(existsSync("public/adstudio-templates/meta-feed-018/sample.png"));
  assert.ok(existsSync("src/lib/adstudio/template-assets-v2/meta-feed-018/plate-feed.webp"));
});

test("template asset resolver maps logical render parts to private storage and fails closed", () => {
  const fakeRoot = resolve("/tmp", "blockwise-asset-contract");
  assert.equal(
    resolveTemplateAssetPath(fakeRoot, "/adstudio-templates/meta-feed-018/plate-feed.webp"),
    join(fakeRoot, "src", "lib", "adstudio", "template-assets-v2", "meta-feed-018", "plate-feed.webp"),
  );
  assert.equal(
    resolveTemplateAssetPath(fakeRoot, "/plates/fixture-feed.png"),
    join(fakeRoot, "public", "plates", "fixture-feed.png"),
  );
  assert.throws(
    () => resolveTemplateAssetPath(fakeRoot, "/adstudio-templates/meta-feed-018/sample.png"),
    /refusing non-private template asset path/,
  );
  assert.throws(
    () => resolveTemplateAssetPath(fakeRoot, "/plates/..\/..\/secret"),
    /refusing to resolve escaping public path/,
  );
});

test("customer and operator editors never request raw template render parts", () => {
  const canvas = read("src/components/adstudio/editor/editor-canvas.tsx");
  const stage = read("src/components/adstudio/editor/v2-editor-stage.tsx");
  const studio = read("src/components/operator/template-studio-client.tsx");
  assert.match(canvas, /\/api\/adstudio\/media\?path=/);
  assert.doesNotMatch(canvas, /layout\.plate\.src|layer\.src|useAssetUrl|focalCoverSourceRect/);
  assert.match(stage, /\/api\/adstudio\/media\?path=/);
  assert.doesNotMatch(studio, /EditorRoot/);
  assert.match(studio, /doc\.provenance\.sample\.imageSrc/);
});

test("browser auth state is ignored and never committed", () => {
  assert.equal(existsSync("e2e/.auth/adstudio-test.storage-state.json"), false);
  assert.match(read(".gitignore"), /(?:^|\n)e2e\/\.auth\/(?:\n|$)/);
});

test("the doc contract is the single v2 schema source", () => {
  const contract = read("src/lib/adstudio/v2/template-doc.ts");
  assert.match(contract, /templateDocV2Schema/);
  assert.match(contract, /adDocInstanceSchema/);
  const gate = read("scripts/verify/adstudio-templates-v2.mjs");
  assert.match(gate, /templateDocV2Schema/);
});

test("truth gate rejects vacuous ready evidence and treats every stress failure as a failure", () => {
  const gate = read("scripts/verify/adstudio-templates-v2.mjs");
  assert.match(gate, /sourceCuration/);
  assert.match(gate, /lacks a non-blank sourceValues record/);
  assert.match(gate, /reviewerUserId/);
  assert.match(gate, /native fidelity changed pixels outside editable text regions/);
  assert.match(gate, /stress evidence matrix hash is stale or fabricated/);
  assert.match(gate, /runNativeSurfaceFidelity/);
  assert.match(gate, /runStressMatrix/);
  assert.doesNotMatch(gate, /error\?\.name !== "RenderFitError"/);
});

test("auto QA is advisory and cannot impersonate a human approval", () => {
  const autoQa = read("scripts/adstudio/v2/auto-qa.mjs");
  assert.doesNotMatch(autoQa, /approveTemplate/);
  assert.doesNotMatch(autoQa, /status\s*=\s*["']ready/);
  assert.doesNotMatch(autoQa, /writeFileSync/);
  assert.match(autoQa, /no docs changed and none approved/);
});
