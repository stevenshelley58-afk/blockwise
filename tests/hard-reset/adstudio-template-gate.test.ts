import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const gate = "scripts/verify/adstudio-templates.mjs";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const rubricVersion = "adstudio-subject-invariant-clone-v1";
const qualifiedAt = "2026-08-09T00:00:00.000Z";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

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
    meta: {
      platform: "meta", objective: "OUTCOME_LEADS", specialAdCategory: "housing",
      leadForm: {
        headline: "Request the property details",
        questions: ["What is your best contact number?"],
        privacyPolicyUrl: null,
        thankYouScreen: { title: "Request received", body: "The agency will be in touch shortly." },
      },
    },
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

function passingReview(input: {
  templateId: string;
  requestHash: string;
  outputHash: string;
  copy: Record<string, string>;
  assetKeys: string[];
  likeness?: number;
  quality?: number;
}) {
  return {
    schemaVersion: 1,
    rubricVersion,
    templateId: input.templateId,
    requestHash: input.requestHash,
    candidateHash: input.outputHash,
    reviewer: { provider: "test", model: "vision" },
    adSystemLikenessScore: input.likeness ?? 9.7,
    standaloneAdQualityScore: input.quality ?? 9.4,
    excludedContentInfluencedScore: false,
    copyChecks: Object.entries(input.copy).map(([key, expected]) => ({ key, expected, observed: expected, exact: true })),
    assetChecks: input.assetKeys.map((key) => ({ key, used: true, faithful: true, notes: "faithful" })),
    identityLeakage: [],
    defects: [],
    includedRationale: "The reusable system matches.",
    qualityRationale: "The ad is polished.",
    suggestedCorrection: "",
    reviewedAt: qualifiedAt,
  };
}

function writeQualityRelease(root: string, value: ReturnType<typeof template>) {
  // Release fixtures model the same fail-closed runtime contract as production:
  // every quality-locked template has a complete offline editor map and a
  // self-hosted, manifest-verified font face.
  const fontFile = "/fonts/adstudio/TestFont-Regular.woff2";
  const fontContent = "fake-font-data";
  mkdirSync(join(root, "public", "fonts", "adstudio"), { recursive: true });
  writeFileSync(join(root, "public", fontFile.slice(1)), fontContent);
  writeFileSync(join(root, "public", "fonts", "adstudio", "manifest.json"), JSON.stringify({
    faces: [{
      file: fontFile,
      fontId: "TestFont",
      weight: 700,
      italic: false,
      sha256: hash(fontContent),
    }],
    excluded: [],
  }));
  const headlineTypography = value.typography.headline as typeof value.typography.headline & {
    fontFile?: string;
  };
  headlineTypography.fitScore = 0.8;
  headlineTypography.detectionScore = 0.8;
  headlineTypography.fontFile = fontFile;
  (value as typeof value & { deterministicEditing: {
    status: "ready";
    imageBoxes: Record<string, { x: number; y: number; width: number; height: number }>;
  } }).deterministicEditing = {
    status: "ready",
    imageBoxes: { property_photo: { x: 0.1, y: 0.25, width: 0.8, height: 0.5 } },
  };
  const templatePath = join(root, "gallery", `${value.id}.json`);
  const templateHash = hash(canonicalJson(value));
  writeFileSync(templatePath, JSON.stringify({ ...value, qualityLock: { templateHash } }));
  const sampleRequestHash = hash("gallery-request");
  const customerRequestHash = hash("customer-request");
  const sampleCopy = { headline: value.inputs.text[0]!.sample };
  const customerCopy = { headline: "CUSTOMER COPY" };
  const sampleAssetHash = hash("gallery-property-photo");
  const customerAssetHash = hash("customer-property-photo");
  const customerOutputHash = hash("customer-candidate");
  const sampleReview = passingReview({
    templateId: value.id,
    requestHash: sampleRequestHash,
    outputHash: value.sample.contentHash,
    copy: sampleCopy,
    assetKeys: ["property_photo"],
  });
  const customerReview = passingReview({
    templateId: value.id,
    requestHash: customerRequestHash,
    outputHash: customerOutputHash,
    copy: customerCopy,
    assetKeys: ["property_photo"],
    likeness: 9.6,
    quality: 9.3,
  });
  const evidence = {
    schemaVersion: 2,
    templateId: value.id,
    templateHash,
    sampleHash: value.sample.contentHash,
    rubricVersion,
    thresholds: { adSystemLikeness: 9.5, standaloneAdQuality: 9 },
    qualifiedAt,
    sample: {
      stage: "gallery_sample",
      requestHash: sampleRequestHash,
      referenceHash: value.sourceAd.contentHash,
      references: [
        { index: 1, key: "source_ad", role: "source", contentHash: value.sourceAd.contentHash },
        { index: 2, key: "property_photo", role: "replacement_asset", contentHash: sampleAssetHash },
      ],
      copy: sampleCopy,
      outputHash: value.sample.contentHash,
      executionTransport: "test",
      reviewedAt: qualifiedAt,
      review: sampleReview,
    },
    customerFixture: {
      stage: "customer_fixture",
      requestHash: customerRequestHash,
      referenceHash: value.sample.contentHash,
      references: [
        { index: 1, key: "approved_sample", role: "approved_sample", contentHash: value.sample.contentHash },
        { index: 2, key: "property_photo", role: "replacement_asset", contentHash: customerAssetHash },
      ],
      copy: customerCopy,
      outputHash: customerOutputHash,
      executionTransport: "test",
      reviewedAt: qualifiedAt,
      review: customerReview,
    },
  };
  const evidenceDir = join(root, "gallery", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `${value.id}.json`);

  const write = () => {
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const lock = {
      templateHash,
      templateContract: canonicalJson(value),
      sampleHash: value.sample.contentHash,
      evidenceHash: hash(readFileSync(evidencePath)),
      sampleLikeness: sampleReview.adSystemLikenessScore,
      sampleQuality: sampleReview.standaloneAdQualityScore,
      customerFixtureLikeness: customerReview.adSystemLikenessScore,
      customerFixtureQuality: customerReview.standaloneAdQualityScore,
      qualifiedAt,
    };
    writeFileSync(join(root, "gallery", "quality-locks.json"), JSON.stringify({
      schemaVersion: 1,
      templates: { [value.id]: lock },
    }));
    return lock;
  };

  return { evidence, evidencePath, write };
}

function run(root?: string) {
  return spawnSync(process.execPath, [gate], {
    encoding: "utf8",
    env: root ? {
      ...process.env,
      ADSTUDIO_GALLERY_DIR: join(root, "gallery"),
      ADSTUDIO_PUBLIC_DIR: join(root, "public"),
    } : process.env,
  });
}

test("the installed gallery enforces release quality-lock readiness", () => {
  const result = run();
  const indexPath = join(process.cwd(), "src", "lib", "adstudio", "template-gallery", "quality-locks.json");
  const lockCount = existsSync(indexPath)
    ? Object.keys(JSON.parse(readFileSync(indexPath, "utf8")).templates ?? {}).length
    : 0;
  if (lockCount > 0) assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  else {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at least one valid template lock/u);
  }
});

test("a gallery without a release index remains valid but has no release locks", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    const result = run(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /no release quality-lock index/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the gate rejects orphan evidence and display thumbnails", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    mkdirSync(join(root, "gallery", "evidence"), { recursive: true });
    writeFileSync(join(root, "gallery", "evidence", "meta-retired.json"), "{}");
    mkdirSync(join(root, "public", "adstudio-thumbnails", "meta"), { recursive: true });
    writeFileSync(join(root, "public", "adstudio-thumbnails", "meta", "retired-preview.webp"), "old");

    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ORPHAN_EVIDENCE/u);
    assert.match(result.stderr, /ORPHAN_THUMBNAIL/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a release index requires at least one valid lock", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    writeFileSync(join(root, "gallery", "quality-locks.json"), JSON.stringify({ schemaVersion: 1, templates: {} }));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at least one valid template lock/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a valid quality lock requires passing gallery and distinct customer evidence", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    writeQualityRelease(root, value).write();
    const result = run(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /1 quality locked/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the release gate rejects stale evidence hashes and below-threshold locks", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    const release = writeQualityRelease(root, value);
    release.write();
    writeFileSync(release.evidencePath, `${JSON.stringify(release.evidence)}\n`);
    let result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /evidenceHash does not match/u);

    const lock = release.write();
    lock.sampleLikeness = 9.4;
    writeFileSync(join(root, "gallery", "quality-locks.json"), JSON.stringify({
      schemaVersion: 1,
      templates: { [value.id]: lock },
    }));
    result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sampleLikeness must be between 9\.5 and 10/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("evidence v2 rejects reused customer fixtures and failed exact QA", () => {
  const root = fixtureRoot();
  try {
    const value = template(root, 1);
    writeFileSync(join(root, "gallery", `${value.id}.json`), JSON.stringify(value));
    const release = writeQualityRelease(root, value);
    release.evidence.customerFixture.copy = release.evidence.sample.copy;
    release.evidence.customerFixture.references[1]!.contentHash = release.evidence.sample.references[1]!.contentHash;
    release.evidence.customerFixture.review.copyChecks[0]!.exact = false;
    release.write();
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /copy check failed|copy must differ|distinct property_photo asset/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
