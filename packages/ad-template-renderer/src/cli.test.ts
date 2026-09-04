import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AdTemplate } from "@blockwise/ad-template-contract";
import { TEXT_PREFLIGHT_ERROR_CODE } from "./renderer.ts";

const colours = {
  background: "#ffffff",
  primary: "#111111",
  secondary: "#777777",
  accent: "#ff5500",
  mainText: "#111111",
  inverseText: "#ffffff",
};

test("CLI text refusal is one path-free line and leaves no partial output or receipt", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ad-template-preflight-"));
  try {
    const template: AdTemplate = {
      schema: "blockwise.ad-template",
      templateId: "cli-preflight",
      createdAt: "2026-09-04T00:00:00.000Z",
      feedLayout: {
        placement: "feed",
        layers: [
          { type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
          { type: "text", layerId: "feed-email-text", inputKey: "email", font: { file: "manrope-800.woff2" }, fontSize: 30, lineHeight: 1, tracking: 1, alignment: "left", maxCharacters: 40, maxLines: 1, colourRole: "mainText", overflowBehaviour: "scale_down", geometry: { x: 20, y: 20, width: 8, height: 8 } },
        ],
        safeZones: [],
      },
      storyLayout: {
        placement: "story",
        layers: [
          { type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true },
          { type: "text", layerId: "story-phone-text", inputKey: "phone", font: { file: "manrope-800.woff2" }, fontSize: 36, lineHeight: 1, tracking: 1, alignment: "left", maxCharacters: 40, maxLines: 1, colourRole: "mainText", overflowBehaviour: "scale_down", geometry: { x: 20, y: 20, width: 8, height: 8 } },
        ],
        safeZones: [],
      },
      imageInputs: [],
      textInputs: [
        { key: "email", label: "Email", placeholder: "hello@example.com", maxLength: 40 },
        { key: "phone", label: "Phone", placeholder: "+61 400 000 000", maxLength: 40 },
      ],
      semanticColours: colours,
      assets: {},
      fonts: [{ file: "manrope-800.woff2" }],
      metadata: {
        title: "CLI preflight",
        description: "",
        gallerySamples: {},
        metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
        aiWritingGuidance: { summary: "", fields: {} },
        publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] },
        replacementAssets: [],
        realAssetRefs: [],
      },
    };
    const artifactPath = join(scratch, "artifact.json");
    const outDir = join(scratch, "rendered");
    await writeFile(artifactPath, JSON.stringify({ template, assets: [] }));
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(sourceDir, "../../..");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", join(sourceDir, "cli.ts"), "--input", artifactPath, "--assets-dir", join(repoRoot, "public/fonts/adstudio"), "--out-dir", outDir],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const stderr = result.stderr.trim();
    assert.equal(stderr.split(/\r?\n/).length, 1);
    assert.ok(stderr.startsWith(`${TEXT_PREFLIGHT_ERROR_CODE} `));
    assert.match(stderr, /feed text layer feed-email-text cannot fit at the 24px readability floor/);
    assert.match(stderr, /story text layer story-phone-text cannot fit at the 32px readability floor/);
    assert.doesNotMatch(stderr, /renderer\.(?:ts|js)|[A-Za-z]:\\|\/opt\//);
    await assert.rejects(access(outDir));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
