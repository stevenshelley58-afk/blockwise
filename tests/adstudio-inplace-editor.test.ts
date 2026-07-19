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

test("undo and redo are durable checked revision mutations", () => {
  assert.match(editor, /restoreVersion\("undo"\)/);
  assert.match(editor, /restoreVersion\("redo"\)/);
  assert.match(route, /action === "undo" \|\| action === "redo"/);
  assert.match(route, /appendAdStudioCreativeRevision/);
  assert.match(route, /redoHistory/);
  assert.match(route, /runCloneQa\(/);
  assert.match(route, /That version no longer passes the ad checks/);
});

test("edits stay model-driven and save only after bounded QA", () => {
  assert.doesNotMatch(route, /renderExactCloneTextEdit/);
  assert.doesNotMatch(route, /applyDeterministicTextEditQa/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /compositeCloneRegionEdit/);
  assert.match(route, /cloneQaCorrectionPrompt/);
  assert.match(route, /if \(!lastImage \|\| \(qa && !qa\.passed\)\)/);
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

test("regions are object-aware: hover labels, selection spotlight, corner handles, keyboard walk", () => {
  assert.match(editor, /data-label=\{labelForRegionKey\(region\.key\)\}/);
  assert.match(styles, /\.studio-inplace-region::before\{content:attr\(data-label\)/);
  assert.match(styles, /0 0 0 9999px rgba\(6,10,18,\.34\)/);
  assert.match(editor, /studio-inplace-handles/);
  assert.match(styles, /\.studio-inplace-handles\{position:absolute/);
  // Arrow keys cycle elements in place; Escape releases the selection.
  assert.match(editor, /handleRegionKeyDown\(event, index\)/);
  assert.match(editor, /ArrowRight/);
  assert.match(editor, /regionButtonRefs\.current\.get\(next\.key\)\?\.focus\(\)/);
});

test("zoom is available for small targets: toolbar cycle, double-click, drag pan", () => {
  assert.match(editor, /studio-inplace-zoom/);
  assert.match(editor, /cycleZoom/);
  assert.match(editor, /handleZoomDoubleClick/);
  assert.match(editor, /setPointerCapture/);
  // Pan deltas convert through the outer PreviewFit scale and stay clamped.
  assert.match(editor, /frameScaleFactor/);
  assert.match(editor, /clampPan/);
  assert.match(styles, /\.studio-inplace-zoom\{position:relative/);
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-zoom,\.studio-metachrome-story \.studio-inplace-zoom\{display:block;width:100%;height:100%\}/);
});

test("element list shows real thumbnails and flags inexact copy", () => {
  assert.match(editor, /regionThumbStyle\(src, region\.box\)/);
  assert.match(editor, /warningKeys\.has\(region\.key\)/);
  assert.match(styles, /\.studio-inplace-thumb\{width:26px/);
  assert.match(styles, /\.studio-inplace-flag\{width:8px/);
  // Pending edits narrate what they are doing instead of a generic label.
  assert.match(editor, /truncateForStatus/);
  assert.match(editor, /Repainting this area/);
});

test("unverified renders never enter the editor as a partial result", () => {
  assert.doesNotMatch(workbench, /editorPreparing/);
  assert.doesNotMatch(editor, /Preparing your editor/);
  assert.doesNotMatch(styles, /studio-editor-preparing/);
});
