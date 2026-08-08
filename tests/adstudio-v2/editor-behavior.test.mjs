// §14 behaviour-bar port: the new editor keeps the in-place editor's
// a11y/interaction contract — 44px hit targets, arrow-key walk, Escape,
// Enter-to-edit, undo/redo, maxLength counter. Source-contract style, same
// as the repo's other UI bar tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = readFileSync("src/components/adstudio/editor/editor-root.tsx", "utf8");
const canvas = readFileSync("src/components/adstudio/editor/editor-canvas.tsx", "utf8");
const overlay = readFileSync("src/components/adstudio/editor/text-edit-overlay.tsx", "utf8");
const toolbar = readFileSync("src/components/adstudio/editor/toolbar.tsx", "utf8");
const panels = readFileSync("src/components/adstudio/editor/panels.tsx", "utf8");
const hook = readFileSync("src/components/adstudio/editor/state/use-editor-doc.ts", "utf8");

test("editor root: keyboard walk (arrows), Escape deselect, Enter opens text edit", () => {
  assert.match(root, /ArrowRight/);
  assert.match(root, /ArrowLeft/);
  assert.match(root, /Escape/);
  assert.match(root, /Enter/);
  assert.match(root, /aria-label="Ad editor canvas/);
});

test("text overlay: Esc cancels, Cmd/Ctrl+Enter commits, live maxLength counter", () => {
  assert.match(overlay, /Escape/);
  assert.match(overlay, /metaKey \|\| event\.ctrlKey/);
  assert.match(overlay, /\{draft\.length\}\/\{maxLength\}/);
});

test("canvas: 44px hit targets on text layers", () => {
  assert.match(canvas, /hitStrokeWidth=\{44\}/);
});

test("toolbar: undo/redo, zoom, advanced toggle, save-state chip", () => {
  assert.match(toolbar, /onUndo/);
  assert.match(toolbar, /onRedo/);
  assert.match(toolbar, /onZoomChange/);
  assert.match(toolbar, /Advanced/);
  assert.match(toolbar, /Saving|Unsaved|Saved/);
});

test("panels: zoom slider and low-res guidance for slots", () => {
  assert.match(panels, /Slider/);
  assert.match(panels, /minSourcePx|low|soft|resolution/i);
});

test("guided guard rails: whitelist + palette-only colours (state law)", () => {
  // The hook's reducer delegates every edit to guardAction — the single
  // source of the guided law.
  assert.match(hook, /makeEditorReducer/);
  const state = readFileSync("src/lib/adstudio/v2/editor-state.ts", "utf8");
  assert.match(state, /GUIDED_OVERRIDE_OPS = \["color"\]/);
  assert.match(state, /lockedLayerIds/);
  assert.match(state, /palette\.includes\(action\.color\)/);
});
