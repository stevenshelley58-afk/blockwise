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
    typography: {
      headline: {
        fontId: "TestFont", family: "TestFont", fallbackFamily: "sans-serif",
        weight: 700, italic: false, case: "upper", sizeRatio: 0.05, lineHeight: 1.2,
        tracking: 0, align: "center", color: "#000000",
        fitScore: 0.1, detectionScore: 0.1,
        sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        sampleLineCount: 1,
        measuredLines: [{ text: "TEST", sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, sizeRatio: 0.05 }],
        measurementVersion: 2, measurementSource: "ocr-v2",
      },
    },
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

test("deterministicOnly rejects a template with a text region missing fontFile", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    (value as any).deterministicOnly = true;
    value.typography = {
      headline: {
        fontId: "TestFont", family: "TestFont", fallbackFamily: "sans-serif",
        weight: 700, italic: false, case: "upper", sizeRatio: 0.05, lineHeight: 1.2,
        tracking: 0, align: "center", color: "#000000",
        fitScore: 0.8, detectionScore: 0.8,
        sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        sampleLineCount: 1,
        measuredLines: [{ text: "TEST", sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, sizeRatio: 0.05 }],
        measurementVersion: 2, measurementSource: "ocr-v2",
      },
    };
    writeFileSync(join(root, "gallery", "meta-feed-001.json"), JSON.stringify(value));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deterministicOnly.*fontFile|live gates.*fontFile/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deterministicOnly accepts a template where all text regions pass live gates", () => {
  const root = fixtureRoot();
  try {
    // Set up a minimal font manifest and font file so the live-gate is satisfied.
    mkdirSync(join(root, "public", "fonts", "adstudio"), { recursive: true });
    const fontContent = "fake-font-data";
    const fontHash = hash(fontContent);
    writeFileSync(join(root, "public", "fonts", "adstudio", "TestFont-Regular.woff2"), fontContent);
    writeFileSync(join(root, "public", "fonts", "adstudio", "manifest.json"), JSON.stringify({
      faces: [{ file: "/fonts/adstudio/TestFont-Regular.woff2", fontId: "TestFont", weight: 700, italic: false, sha256: fontHash }],
      excluded: [],
    }));

    const value = template(root, 1);
    (value as any).deterministicOnly = true;
    (value as any).typography = {
      headline: {
        fontId: "TestFont", family: "TestFont", fallbackFamily: "sans-serif",
        weight: 700, italic: false, case: "upper", sizeRatio: 0.05, lineHeight: 1.2,
        tracking: 0, align: "center", color: "#000000",
        fitScore: 0.8, detectionScore: 0.8,
        fontFile: "/fonts/adstudio/TestFont-Regular.woff2",
        sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        sampleLineCount: 1,
        measuredLines: [{ text: "TEST", sampleBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, sizeRatio: 0.05 }],
        measurementVersion: 2, measurementSource: "ocr-v2",
      },
    };
    writeFileSync(join(root, "gallery", "meta-feed-001.json"), JSON.stringify(value));
    const result = run(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("templates without deterministicOnly always pass (assuming other gates pass)", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    // No deterministicOnly field at all
    writeFileSync(join(root, "gallery", "meta-feed-001.json"), JSON.stringify(value));
    const result = run(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
