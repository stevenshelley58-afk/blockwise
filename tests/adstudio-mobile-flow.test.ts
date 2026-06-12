import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("mobile media tab renders the real upload and library panel", () => {
  const mobileBody = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaStart = mobileBody.indexOf('studio.mobileTab === "media"');
  const copyStart = mobileBody.indexOf('studio.mobileTab === "copy"');
  const mediaBlock = mobileBody.slice(mediaStart, copyStart);
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");

  assert.ok(mediaStart > -1);
  assert.ok(copyStart > mediaStart);
  assert.match(mediaBlock, /<MediaPanel[\s\S]*primaryImage=\{primaryImage\}[\s\S]*onUploadImage=\{handleUploadImage\}[\s\S]*onSelectImage=\{selectMediaImage\}/);
  assert.doesNotMatch(mediaBlock, /<VariantStrip/);
  assert.match(mediaPanel, /studio-current-media/);
  assert.match(mediaPanel, /Upload image/);
  assert.match(mediaPanel, /AssetUploadDropzone/);
  assert.match(mediaPanel, /capturePagePaste/);
});

test("brief copy generation leaves editable copy visible with inline feedback", () => {
  const panel = read("src/components/adstudio/panels/copy-panel.tsx");
  const hook = read("src/components/adstudio/use-copy.ts");
  const briefStart = panel.indexOf('copyMode === "brief" &&');
  const ownStart = panel.indexOf('copyMode === "own" &&', briefStart);
  const briefBlock = panel.slice(briefStart, ownStart);

  assert.ok(briefStart > -1);
  assert.ok(ownStart > briefStart);
  assert.match(briefBlock, /Generate copy from brief/);
  assert.match(briefBlock, /<CopyFields copy=\{copy\} updateCopy=\{updateCopy\}/);
  assert.match(panel, /studio-inline-feedback/);
  assert.match(hook, /feedback/);
  assert.match(hook, /Copy updated from your brief/);
});

test("mobile campaign chip opens ad details instead of acting like a dead dropdown", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const styles = read("src/components/adstudio/styles.ts");

  assert.match(workbench, /const \[mobileAdDetailsOpen, setMobileAdDetailsOpen\]/);
  assert.match(workbench, /onClick=\{\(\) => setMobileAdDetailsOpen\(true\)\}/);
  assert.match(workbench, /className="studio-mobile-sheet"/);
  assert.match(workbench, /renderCampaignPanel\(\{ mobileSheet: true \}\)/);
  assert.match(styles, /studio-mobile-sheet-backdrop/);
});

test("mobile overflow exposes save draft", () => {
  const topbar = read("src/components/adstudio/topbar.tsx");
  const styles = read("src/components/adstudio/styles.ts");

  assert.match(topbar, /function handleSaveFromMenu\(\)/);
  assert.match(topbar, /studio-mobile-menu-save/);
  assert.match(topbar, /Save draft/);
  assert.match(styles, /\.studio-more-menu \.studio-mobile-menu-save\{display:none\}/);
  assert.match(styles, /\.studio-more-menu \.studio-mobile-menu-save\{display:grid\}/);
});
