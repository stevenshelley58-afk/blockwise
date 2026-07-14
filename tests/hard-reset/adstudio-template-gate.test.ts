import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const gate = "scripts/verify/adstudio-templates.mjs";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "adstudio-gate-"));
  for (const dir of ["gallery", "public/samples", "sources"]) mkdirSync(join(root, dir), { recursive: true });
  return root;
}

function template(root: string, n: number, intent = "listing") {
  const id = `meta-feed-${String(n).padStart(3, "0")}`;
  const source = `source-${n}`;
  const sample = `sample-${n}`;
  writeFileSync(join(root, "sources", `${id}.png`), source);
  writeFileSync(join(root, "public", "samples", `${id}.png`), sample);
  return {
    id, name: "Ad", goal: "seller_leads", offerId: `offer-${n}`, source: "builtin", status: "approved",
    format: "4:5", dimensions: { width: 1080, height: 1350 }, audienceIntent: "Local prospects", category: "listing", tags: ["listing"],
    sample: { imageSrc: `/samples/${id}.png`, thumbnailSrc: `/samples/${id}.png`, alt: "Safe generated sample", contentHash: hash(sample), generatedBy: "reference_clone" },
    inputs: {
      images: [{ key: "property_photo", label: "Property image", required: true, description: "customer property image" }],
      text: [{ key: "headline", label: "Headline", maxLength: 30, sample: "JUST LISTED", required: true }],
    },
    sourceAd: { file: `${id}.png`, contentHash: hash(source) },
    classification: { ad_type: "listing", primary_intent: intent, property_or_agent_focus: "property" },
    meta: { platform: "meta", objective: "OUTCOME_LEADS", specialAdCategory: "housing" },
  };
}

function run(root?: string) {
  return spawnSync(process.execPath, [gate], {
    encoding: "utf8",
    env: root ? {
      ...process.env,
      ADSTUDIO_GALLERY_DIR: join(root, "gallery"),
      ADSTUDIO_PUBLIC_DIR: join(root, "public"),
      ADSTUDIO_SOURCE_DIR: join(root, "sources"),
    } : process.env,
  });
}

test("the installed gallery passes", () => {
  const result = run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
test("the gate rejects old canvas/version fields", () => {
  const root = fixtureRoot();
  try {
    const value = { ...template(root, 1), canvas: {}, version: "v2" };
    writeFileSync(join(root, "gallery", "meta-feed-001.json"), JSON.stringify(value));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /old template field is forbidden/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the gate rejects a source ad masquerading as the public sample", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    value.sample.contentHash = value.sourceAd.contentHash;
    writeFileSync(join(root, "public", "samples", "meta-feed-001.png"), "source-1");
    writeFileSync(join(root, "gallery", "meta-feed-001.json"), JSON.stringify(value));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generated clone|private source/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("semantic diversity still rejects a homogeneous gallery at scale", () => {
  const root = fixtureRoot();
  try {
    for (let n = 1; n <= 12; n += 1) {
      const value = template(root, n);
      writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    }
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DIVERSITY|dominates|distinct primary intents/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
