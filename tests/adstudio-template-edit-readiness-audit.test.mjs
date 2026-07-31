import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/adstudio/audit-template-edit-readiness.mjs");

async function fixtureGallery(templates) {
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-readiness-audit-"));
  const gallery = path.join(root, "gallery");
  await mkdir(gallery);
  await Promise.all(Object.entries(templates).map(([id, template]) => writeFile(
    path.join(gallery, `${id}.json`), `${JSON.stringify({ id, inputs: { text: [], images: [] }, ...template })}\n`,
  )));
  return gallery;
}

function run(gallery, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, ADSTUDIO_GALLERY_DIR: gallery },
    encoding: "utf8",
  });
}

test("read-only migration audit reports every input blocker and supports a comma-separated selection", async () => {
  const gallery = await fixtureGallery({
    "meta-ready": {
      inputs: { text: [{ key: "headline", label: "Headline", required: true }], images: [{ key: "hero", label: "Hero", required: true }] },
      typography: { headline: { measurementVersion: 2, measurementSource: "ocr-v2", sampleBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, sampleLineCount: 1, measuredLines: [{ text: "Headline", sampleBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, sizeRatio: 0.8 }], fitScore: 0.9, detectionScore: 0.9, fontFile: "/fonts/adstudio/test.woff2" } },
      deterministicEditing: { status: "ready", imageBoxes: { hero: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 } } },
    },
    "meta-blocked": {
      inputs: { text: [{ key: "headline", label: "Headline", required: true }], images: [{ key: "hero", label: "Hero", required: true }] },
      typography: { headline: { measurementVersion: 2, measurementSource: "ocr-v2", sampleBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, sampleLineCount: 1, measuredLines: [{ text: "Headline", sampleBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, sizeRatio: 0.8 }], fitScore: 0.2, detectionScore: 0.9 } },
      deterministicEditing: { status: "partial", imageBoxes: {} },
    },
  });
  const result = run(gallery, "--template", "meta-ready,meta-blocked");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.summary, {
    templates: 2, ready: 1, partial: 1, legacy: 0,
    declaredTextInputs: 2, declaredImageInputs: 2, readyInputs: 2, blockedInputs: 2, blockers: 4,
  });
  const blocked = report.templates.find((template) => template.templateId === "meta-blocked");
  assert.equal(blocked.status, "partial");
  assert.deepEqual(blocked.blockers, [
    "template.deterministic_editing_not_ready",
    "text.headline.font_fit_below_threshold",
    "text.headline.missing_self_hosted_font",
    "image.hero.missing_or_invalid_editor_hitbox",
  ]);
});

test("read-only migration audit rejects unknown template ids", async () => {
  const gallery = await fixtureGallery({ "meta-known": {} });
  const result = run(gallery, "--template=meta-missing");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown template id\(s\): meta-missing/u);
});
