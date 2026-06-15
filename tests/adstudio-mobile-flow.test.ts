import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("mobile edit tab renders the contextual inspector and no separate media/copy tabs", () => {
  const mobileBody = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");

  assert.match(mobileBody, /studio\.mobileTab === "campaign"[\s\S]*renderPanel\(\)/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "media"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "copy"/);
  assert.match(mobileBody, /label: "Edit"/);
  assert.match(mediaPanel, /studio-current-media/);
  assert.match(mediaPanel, /Upload image/);
  assert.match(mediaPanel, /AI fit all ad sizes/);
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
