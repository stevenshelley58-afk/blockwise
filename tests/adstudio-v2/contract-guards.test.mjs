// Contract guards for the dedicated VPS builder runtime. Frank owns the UI;
// Blockwise and Vercel must not grow a second Ad Studio operator surface.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { resolveTemplateAssetPath } from "../../src/lib/adstudio/v2/render/assets.ts";

const read = (path) => readFileSync(path, "utf8");

test("the dedicated builder is not attached to the Vercel build lifecycle", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts.build, "next build");
  assert.doesNotMatch(scripts.prebuild ?? "", /adstudio/i);
});

test("Blockwise does not regain the removed v2 API or operator UI", () => {
  for (const path of [
    "src/app/api/adstudio/campaigns/route.ts",
    "src/app/api/adstudio/templates-v2/[id]/route.ts",
    "src/app/api/operator/template-studio/[id]/route.ts",
    "src/components/operator/template-studio-client.tsx",
    "src/components/adstudio/meta-frame",
  ]) {
    assert.equal(existsSync(path), false, `${path} must remain absent`);
  }
});

const IMAGE_MODEL_IMPORT = /(^|[^/\w])(import[\s{]|from\s|require\(|await import\()[^\n]*(ai-providers|clone-generation)/m;

test("the deterministic renderer cannot import image-model registries", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:mjs|ts|tsx)$/.test(entry.name) && IMAGE_MODEL_IMPORT.test(read(path))) offenders.push(path);
    }
  };
  walk("src/lib/adstudio/v2");
  assert.deepEqual(offenders, [], `image model reachable from deterministic renderer: ${offenders.join(", ")}`);
});

test("masked cleanup keeps image-model edits inside the declared text mask", () => {
  const decompose = read("scripts/adstudio/v2/lib/decompose.mjs");
  assert.match(decompose, /form\.append\("mask"/);
  assert.match(decompose, /Edit only the transparent masked regions/);
  assert.match(decompose, /blend: "dest-in"/);
  assert.match(decompose, /blend: "over"/);
});

test("exactly one canonical v2 renderer is defined", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && read(path).includes("export async function renderAdDocToPng")) hits.push(path);
    }
  };
  walk("src");
  assert.deepEqual(hits, [join("src", "lib", "adstudio", "v2", "render", "server.ts")]);
});

test("source-derived render parts are private and path resolution fails closed", () => {
  const leaked = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^(?:plate|patch)-/.test(entry.name)) leaked.push(path);
    }
  };
  walk("public/adstudio-templates");
  assert.deepEqual(leaked, []);

  const fakeRoot = resolve("/tmp", "blockwise-asset-contract");
  assert.equal(
    resolveTemplateAssetPath(fakeRoot, "/adstudio-templates/meta-feed-018/plate-feed.webp"),
    join(fakeRoot, "src", "lib", "adstudio", "template-assets-v2", "meta-feed-018", "plate-feed.webp"),
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

test("the doc contract is the single schema source", () => {
  const contract = read("src/lib/adstudio/v2/template-doc.ts");
  assert.match(contract, /templateDocV2Schema/);
  assert.match(contract, /adDocInstanceSchema/);
});

test("auto QA is advisory and cannot impersonate a human approval", () => {
  const autoQa = read("scripts/adstudio/v2/auto-qa.mjs");
  assert.doesNotMatch(autoQa, /approveTemplate/);
  assert.doesNotMatch(autoQa, /status\s*=\s*["']ready/);
  assert.doesNotMatch(autoQa, /writeFileSync/);
  assert.match(autoQa, /no docs changed and none approved/);
});
