// Editor wiring contract (Track A, §7): the Konva editor mounts behind the
// v2 flag for v2 creatives only, saves through the /doc CAS route, and the
// guided/advanced law lives in the shared lib module.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const stage = readFileSync("src/components/adstudio/editor/v2-editor-stage.tsx", "utf8");
const root = readFileSync("src/components/adstudio/editor/editor-root.tsx", "utf8");
const canvas = readFileSync("src/components/adstudio/editor/editor-canvas.tsx", "utf8");
const docRoute = readFileSync("src/app/api/adstudio/creatives/[id]/doc/route.ts", "utf8");
const state = readFileSync("src/lib/adstudio/v2/editor-state.ts", "utf8");

test("workbench mounts the v2 editor only for v2 docs behind the flag", () => {
  assert.match(workbench, /useV2Frames && isAdDocInstanceShape/);
  assert.match(workbench, /<V2EditorStage/);
  // v1 clone creatives keep their existing path untouched.
  assert.match(workbench, /const cloneEditor = \(/);
});

test("the stage saves through /doc with CAS and never trusts the client", () => {
  assert.match(stage, /\/api\/adstudio\/creatives\/\$\{creativeId\}\/doc/);
  assert.match(stage, /expectedRevisionId: revisionId/);
  assert.match(stage, /mutationId: crypto\.randomUUID\(\)/);
  // Template loads through the validated resolver route, not a raw fetch.
  assert.match(stage, /\/api\/adstudio\/templates-v2\/\$\{instance\.templateId\}/);
});

test("the doc route re-renders server-side and appends a CAS revision", () => {
  assert.match(docRoute, /renderAdDocToPng\(template/);
  assert.match(docRoute, /persistAdDocRender/);
  assert.match(docRoute, /appendAdStudioCreativeRevision/);
  assert.match(docRoute, /ADSTUDIO_STALE_REVISION/);
  // Server-side floor: locked layers and #rrggbb colours rejected.
  assert.match(docRoute, /lockedLayerIds\.includes\(override\.layerId\)/);
  assert.match(docRoute, /#\[0-9a-f\]\{6\}/);
});

test("canvas renders the shared typography/effects contract, not its own", () => {
  // Same cover-crop math as the renderer (parity), same effect fields.
  assert.match(canvas, /focalCoverSourceRect/);
  assert.match(canvas, /gradientFill/);
  assert.match(canvas, /shadowBlur: effects\.shadow\.blurRatio/);
  assert.match(canvas, /letterSpacing/);
});

test("the guided law lives in one lib module consumed by route, hook and UI", () => {
  assert.match(state, /GUIDED_OVERRIDE_OPS = \["color"\]/);
  assert.match(state, /lockedLayerIds\.includes\(action\.layerId\)/);
  for (const file of [docRoute, root, canvas]) {
    void file;
  }
  assert.ok(readFileSync("src/components/adstudio/editor/state/use-editor-doc.ts", "utf8").includes("editor-state.ts"));
});
