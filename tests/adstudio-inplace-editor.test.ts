import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const editor = readFileSync("src/components/adstudio/canvas/in-place-ad-editor.tsx", "utf8");
const route = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");
const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const styles = readFileSync("src/components/adstudio/styles.ts", "utf8");

test("finished-ad editor supports exact text, prompt image edits, and replacement images", () => {
  assert.match(editor, /newValue: value/);
  assert.match(editor, /instruction: value/);
  assert.match(editor, /newImage: dataUrl/);
  assert.match(editor, /Apply image edit/);
  assert.match(editor, /Replace with another image/);
  assert.match(editor, /Only this selected area can change/);
  assert.match(editor, /expectedRevisionId: creative\.activeRevisionId/);
  assert.match(editor, /crypto\.randomUUID\(\)/);
});

test("editor exposes both canvas selection and a non-spatial element list", () => {
  assert.match(editor, /creative\.canvas\.cloneQa\?\.regions/);
  assert.match(editor, /left: `\$\{x \* 100\}%`/);
  assert.match(editor, /aria-label={`Edit \$\{labelForRegionKey\(region\.key\)\}`}/);
  assert.match(editor, /aria-label="Editable elements"/);
  assert.match(editor, /aria-pressed=\{selectedKey === region\.key\}/);
  assert.match(editor, /Edit elements/);
});

test("element list exposes overflow controls and aligns each selection to the visible end", () => {
  assert.match(editor, /aria-label="Show previous elements"/);
  assert.match(editor, /aria-label="Show more elements"/);
  assert.match(editor, /left: button\.offsetLeft \+ button\.offsetWidth - list\.clientWidth/);
  assert.match(editor, /scrollSelectedElementToEnd\(region\.key\)/);
  assert.match(editor, /requestAnimationFrame\(\(\) => scrollSelectedElementToEnd\(selectedKey\)\)/);
  assert.match(editor, /ResizeObserver\(updateElementScrollState\)/);
  assert.match(editor, /\[regions\.length, selectedRegion\?\.key, updateElementScrollState\]/);
  assert.match(styles, /\.studio-inplace-element-picker\{display:grid;grid-template-columns:44px minmax\(0,1fr\) 44px/);
  assert.match(styles, /\.studio-inplace-element-list\{position:relative/);
});

test("undo and redo restore instantly from the stored verdict and always succeed", () => {
  assert.match(editor, /restoreVersion\("undo"\)/);
  assert.match(editor, /restoreVersion\("redo"\)/);
  assert.match(route, /action === "undo" \|\| action === "redo"/);
  assert.match(route, /appendAdStudioCreativeRevision/);
  assert.match(route, /redoHistory/);
  // Restores reuse the QA verdict saved with the version - no vision
  // round-trip, and never a rejection.
  assert.match(route, /targetQa \?\? canvas\.cloneQa/);
  assert.doesNotMatch(route, /That version no longer passes/);
});

test("edits save always; verification is advisory and rendering stays model-driven", () => {
  // The destructive blur-and-generic-font RENDER fallback stays banned; the
  // deterministic path below is verdict bookkeeping only.
  assert.doesNotMatch(route, /renderExactCloneTextEdit/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /compositeCloneRegionEdit/);
  // No reroll loop, no QA gate on saving: one render, one advisory check,
  // and a vision outage falls back to deterministic verdict bookkeeping.
  assert.doesNotMatch(route, /cloneQaCorrectionPrompt/);
  assert.doesNotMatch(route, /qa && !qa\.passed/);
  assert.match(route, /applyDeterministicTextEditQa/);
});

test("all editor controls meet the 44px target and adapt to a mobile sheet", () => {
  // The touch minimum lives on an invisible ::after hit-area so the visible
  // dashed outline always matches the detected region exactly.
  assert.match(styles, /\.studio-inplace-region::after\{content:"";position:absolute;left:50%;top:50%;width:max\(100%,44px\);height:max\(100%,44px\)/);
  assert.doesNotMatch(styles, /\.studio-inplace-region\{[^}]*min-width:44px/);
  assert.match(styles, /\.studio-inplace-toolbar button\{min-width:44px;min-height:44px/);
  assert.match(styles, /\.studio-inplace-inspector header button\{width:44px;height:44px/);
  assert.match(styles, /@media\(max-width:1280px\)[\s\S]*\.studio-inplace-inspector\{top:auto/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test("workbench embeds the editor in Meta chrome with honest selection guidance", () => {
  assert.match(workbench, /<MetaChromePreview[\s\S]*?<InPlaceAdEditor[\s\S]*?<\/MetaChromePreview>/);
  assert.match(workbench, /Select text or an image on the ad, or open Edit elements\./);
  assert.match(workbench, /onCreativeChange=\{updateCreative\}/);
  assert.match(workbench, /cloneQaWarnings\(currentCreative\?\.canvas\.cloneQa\)/);
});

test("the ad shows before its advisory QA pass and the editor announces it is preparing", () => {
  // The workbench polls the campaign until verdicts land, merging only the
  // missing cloneQa so local edits are never clobbered.
  assert.match(workbench, /const editorPreparing = pack\.creatives\.some/);
  assert.match(workbench, /preparing=\{editorPreparing\}/);
  assert.match(workbench, /qa && !creative\.canvas\.cloneQa/);
  assert.match(editor, /preparing \?/);
  assert.match(editor, /Preparing your editor/);
  assert.match(styles, /\.studio-editor-preparing\{position:absolute/);
});
