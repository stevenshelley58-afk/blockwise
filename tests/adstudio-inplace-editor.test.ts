import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const editor = readFileSync("src/components/adstudio/canvas/in-place-ad-editor.tsx", "utf8");
const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const styles = readFileSync("src/components/adstudio/styles.ts", "utf8");

test("in-place editor posts targeted edits to the creative edit endpoint", () => {
  assert.match(editor, /\/api\/adstudio\/creatives\/\$\{creative\.creativeId\}\/edit/);
  assert.match(editor, /method: "POST"/);
  // Text and image edits use the endpoint's exact contract keys.
  assert.match(editor, /\{ newValue: value \}/);
  assert.match(editor, /\{ newImage: dataUrl \}/);
  assert.match(editor, /fieldKey, \.\.\.payload/);
  // Failures keep the old image and surface the server error, never silently ship.
  assert.match(editor, /data\.error \|\| "The edit did not render correctly\. Try again\."/);
});

test("hit-targets come from cloneQa.regions as percentages of the normalized box", () => {
  assert.match(editor, /creative\.canvas\.cloneQa\?\.regions/);
  assert.match(editor, /left: `\$\{x \* 100\}%`/);
  assert.match(editor, /top: `\$\{y \* 100\}%`/);
  assert.match(editor, /width: `\$\{width \* 100\}%`/);
  assert.match(editor, /height: `\$\{height \* 100\}%`/);
  // Accessible label per region; keyboard reachable via native buttons.
  assert.match(editor, /aria-label=\{`Edit \$\{labelForRegionKey\(region\.key\)\}`\}/);
  // Inline text editor pre-fills from the QA copy check for the region key.
  assert.match(editor, /copyChecks\.find\(\(item\) => item\.key === key\)/);
});

test("successful edit swaps image, QA verdict and render history on the creative", () => {
  assert.match(editor, /content: data\.image, assetId: data\.image/);
  assert.match(editor, /cloneQa: data\.qa \?\? creative\.canvas\.cloneQa/);
  assert.match(editor, /renderHistory: data\.renderHistory \?\? creative\.canvas\.renderHistory/);
  assert.match(editor, /onCreativeChange\(next\)/);
  assert.match(editor, /showToast\("Updated"\)/);
});

test("undo restores the previous render client-side from renderHistory", () => {
  assert.match(editor, /renderHistory\[renderHistory\.length - 1\]/);
  assert.match(editor, /renderHistory: renderHistory\.slice\(0, -1\)/);
  assert.match(editor, /content: previous, assetId: previous/);
});

test("in-flight edits show an elapsed-time-aware status and disable other regions", () => {
  assert.match(editor, /SLOW_EDIT_MS = 8000/);
  assert.match(editor, /stillWorking \? "Still working…" : "Updating…"/);
  assert.match(editor, /disabled=\{busy && !pending\}/);
});

test("creatives without QA regions show the plain image without a badge", () => {
  assert.match(editor, /if \(regions\.length === 0\)/);
  assert.doesNotMatch(editor, /studio-clone-badge/);
  assert.doesNotMatch(editor, /AI-designed .* the text is part of the image/);
  // The persistent hint only exists on the editable path.
  assert.match(editor, /Click any text on the ad to edit it/);
});

test("workbench renders the in-place editor for clone creatives", () => {
  // P2.2: the editor is embedded in the Meta chrome, never replaced by it.
  assert.match(workbench, /if \(isCloneCreative\(currentCreative\)\) \{\s*return \(\s*<div className="studio-clone-editor-wrap">/);
  assert.match(workbench, /<MetaChromePreview[\s\S]*?<InPlaceAdEditor[\s\S]*?\/>[\s\S]*?<\/MetaChromePreview>/);
  assert.match(workbench, /import\("\.\/canvas\/in-place-ad-editor"\)\.then\(\(mod\) => mod\.InPlaceAdEditor\)/);
  assert.match(workbench, /const InPlaceAdEditor = dynamic/);
  assert.match(workbench, /ssr: false, loading: \(\) => <div className="studio-fabric-loading">Loading editor\.\.\.<\/div>/);
  // The editor replaces the creative in pack state and arms autosave.
  assert.match(workbench, /onCreativeChange=\{updateCreative\}/);
  assert.match(workbench, /showToast=\{studio\.showToast\}/);
  assert.doesNotMatch(workbench, /studio-clone-badge/);
  assert.match(workbench, /studio-clone-warning-strip/);
  assert.match(workbench, /cloneQaWarnings\(currentCreative\?\.canvas\.cloneQa\)/);
});

test("in-place editor styles exist with hover affordance and shimmer", () => {
  assert.match(styles, /\.studio-inplace-region\{position:absolute;min-width:24px;min-height:24px/);
  assert.match(styles, /\.studio-inplace-region:hover:not\(:disabled\),\.studio-inplace-region:focus-visible\{border-color:color-mix\(in srgb,var\(--accent\) 40%,transparent\)/);
  assert.match(styles, /studio-inplace-shimmer/);
  assert.match(styles, /\.studio-inplace-undo\{position:absolute;top:10px;right:10px/);
  assert.match(styles, /\.studio-inplace-hint\{/);
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-hint,\.studio-metachrome-media \.studio-inplace-undo\{display:none\}/);
  assert.match(styles, /\.studio-metachrome-story \.studio-inplace-hint,\.studio-metachrome-story \.studio-inplace-undo\{display:none\}/);
  assert.match(styles, /\.studio-clone-warning-strip\{/);
  assert.doesNotMatch(styles, /\.studio-clone-badge\{/);
});
