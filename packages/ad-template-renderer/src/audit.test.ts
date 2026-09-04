import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import type { AdTemplate } from "@blockwise/ad-template-contract";
import { auditTemplateArtifact } from "./audit.ts";

const colours = {
  background: "#ffffff",
  primary: "#111111",
  secondary: "#777777",
  accent: "#ff5500",
  mainText: "#111111",
  inverseText: "#ffffff",
};

function imageBytes(colour = "#d946ef"): Buffer {
  const canvas = createCanvas(80, 80);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 80, 80);
  ctx.fillStyle = "#111111";
  ctx.fillRect(8, 10, 24, 50);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(40, 20, 30, 16);
  return canvas.toBuffer("image/png");
}

function templateFixture(): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: "audit-fixture",
    createdAt: "2026-09-04T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [
        { type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
        {
          type: "image_slot",
          layerId: "feed-photo-a",
          inputKey: "photo-a",
          geometry: { x: 80, y: 80, width: 240, height: 240 },
          mask: "none",
          minSourceWidth: 1,
          minSourceHeight: 1,
          defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
          allowedPlacementOverrides: ["crop"],
        },
        {
          type: "text",
          layerId: "feed-headline",
          inputKey: "headline",
          font: { file: "manrope-800.woff2" },
          fontSize: 48,
          lineHeight: 1.1,
          tracking: 0,
          alignment: "left",
          maxCharacters: 40,
          maxLines: 1,
          colourRole: "mainText",
          overflowBehaviour: "scale_down",
          geometry: { x: 80, y: 380, width: 700, height: 100 },
        },
      ],
      safeZones: [],
    },
    storyLayout: {
      placement: "story",
      layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }],
      safeZones: [],
    },
    imageInputs: [{ key: "photo-a", label: "Photo A", acceptedTypes: ["image/png"], defaultAssetKey: "asset-a" }],
    textInputs: [{ key: "headline", label: "Headline", placeholder: "HELLO HOME", maxLength: 40 }],
    semanticColours: colours,
    assets: { "asset-a": { fileName: "asset-a.png", mimeType: "image/png" } },
    fonts: [{ file: "manrope-800.woff2" }],
    metadata: {
      title: "Audit fixture",
      description: "Deterministic render audit fixture",
      gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS",
        specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [],
      realAssetRefs: [],
    },
  };
}

function artifactBytes(template: AdTemplate, assets: Array<Record<string, string>>): Buffer {
  return Buffer.from(JSON.stringify({ template, assets }));
}

test("audit emits deterministic hashes, pixel gates, text diagnostics, and informational source metrics", async () => {
  const template = templateFixture();
  const photo = imageBytes();
  const input = {
    artifactBytes: artifactBytes(template, [{
      assetKey: "asset-a",
      fileName: "asset-a.png",
      mimeType: "image/png",
      bytesBase64: photo.toString("base64"),
    }]),
    assetsDir: "public/fonts/adstudio",
    sourceBytes: photo,
    runId: "trun_fixture",
    iteration: 1,
  };
  const result = await auditTemplateArtifact(input);
  const repeated = await auditTemplateArtifact(input);

  assert.equal(result.receipt.verdict, "pass");
  assert.deepEqual(repeated.receipt, result.receipt);
  assert.deepEqual(repeated.outputs, result.outputs);
  assert.match(result.receipt.artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.match(result.receipt.renderer.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    { width: result.receipt.outputs?.feed.width, height: result.receipt.outputs?.feed.height },
    { width: 1080, height: 1350 },
  );
  assert.equal(result.receipt.outputs?.feed.minimumAlpha, 255);
  assert.equal(result.receipt.outputs?.story.minimumAlpha, 255);
  assert.match(result.receipt.outputs!.feed.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.receipt.diagnostics?.text[0]?.status, "painted");
  assert.equal(result.receipt.diagnostics?.text[0]?.lineCount, 1);
  assert.ok(result.receipt.diagnostics?.text[0]?.paintedBounds);
  assert.equal(result.receipt.sourceMacro?.gate, false);
  assert.equal(result.receipt.sourceMacro?.comparisons.length, 2);
  assert.ok(result.receipt.checks.every((check) => check.status === "pass"));
  assert.ok(result.outputs?.feed.length);
  assert.ok(result.outputs?.story.length);
});

test("audit fails distinct image slots whose perceptual content is duplicated", async () => {
  const template = templateFixture();
  template.imageInputs.push({ key: "photo-b", label: "Photo B", acceptedTypes: ["image/png"], defaultAssetKey: "asset-b" });
  template.assets["asset-b"] = { fileName: "asset-b.png", mimeType: "image/png" };
  template.feedLayout.layers.push({
    type: "image_slot",
    layerId: "feed-photo-b",
    inputKey: "photo-b",
    geometry: { x: 360, y: 80, width: 240, height: 240 },
    mask: "none",
    minSourceWidth: 1,
    minSourceHeight: 1,
    defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
    allowedPlacementOverrides: ["crop"],
  });
  const photo = imageBytes();
  const encoded = photo.toString("base64");
  const result = await auditTemplateArtifact({
    artifactBytes: artifactBytes(template, [
      { assetKey: "asset-a", fileName: "asset-a.png", mimeType: "image/png", bytesBase64: encoded },
      { assetKey: "asset-b", fileName: "asset-b.png", mimeType: "image/png", bytesBase64: encoded },
    ]),
    assetsDir: "public/fonts/adstudio",
  });

  assert.equal(result.receipt.verdict, "fail");
  const duplicateCheck = result.receipt.checks.find((check) => check.id === "image_slot_duplicates");
  assert.equal(duplicateCheck?.status, "fail");
  assert.deepEqual(result.receipt.diagnostics?.imageSlots.duplicatePairs, [{
    placement: "feed",
    firstLayerId: "feed-photo-a",
    firstInputKey: "photo-a",
    secondLayerId: "feed-photo-b",
    secondInputKey: "photo-b",
    hammingDistance: 0,
    pixelSimilarity: 1,
  }]);
});

test("audit records schema failure without rendering or writing external state", async () => {
  const result = await auditTemplateArtifact({
    artifactBytes: Buffer.from(JSON.stringify({ template: { schema: "wrong" } })),
    assetsDir: ".",
  });
  assert.equal(result.receipt.verdict, "fail");
  assert.equal(result.receipt.checks[0]?.id, "schema_parse");
  assert.equal(result.receipt.checks[0]?.status, "fail");
  assert.equal(result.outputs, undefined);
});

test("run-directory CLI writes only rerenders and a receipt for the selected iteration", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ad-template-audit-"));
  try {
    const template = templateFixture();
    template.feedLayout.layers = [template.feedLayout.layers[0]!];
    template.storyLayout.layers = [template.storyLayout.layers[0]!];
    template.imageInputs = [];
    template.textInputs = [];
    template.assets = {};
    template.fonts = [];
    await mkdir(join(runDir, "iterations", "01"), { recursive: true });
    await writeFile(join(runDir, "iterations", "01", "artifact.json"), artifactBytes(template, []));
    const cliPath = fileURLToPath(new URL("./audit-cli.ts", import.meta.url));
    const executed = spawnSync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "--run-dir",
      runDir,
      "--iteration",
      "1",
    ], { encoding: "utf8" });
    assert.equal(executed.status, 0, executed.stderr);
    const receipt = JSON.parse(await readFile(join(runDir, "audit", "01", "receipt.json"), "utf8")) as { verdict: string; context: unknown };
    assert.equal(receipt.verdict, "pass");
    assert.deepEqual(receipt.context, { runId: runDir.split(/[\\/]/u).at(-1), iteration: 1 });
    assert.ok((await readFile(join(runDir, "audit", "01", "feed.png"))).length > 0);
    assert.ok((await readFile(join(runDir, "audit", "01", "story.png"))).length > 0);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
