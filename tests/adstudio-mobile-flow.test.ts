import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("mobile nav exposes the canvas-first Ad Studio sections", () => {
  const mobileBody = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");

  assert.match(mobileBody, /studio\.mobileTab === "home"/);
  assert.match(mobileBody, /studio\.mobileTab === "media"/);
  assert.match(mobileBody, /studio\.mobileTab === "text"/);
  assert.match(mobileBody, /label: "Home"/);
  assert.match(mobileBody, /label: "Templates"/);
  assert.match(mobileBody, /templatePickerOpen/);
  assert.match(mobileBody, /label: "Media"/);
  assert.match(mobileBody, /label: "Text"/);
  assert.match(mobileBody, /label: "Publish"/);
  assert.match(mobileBody, /label: "Settings"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "campaign"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "design"/);
  assert.doesNotMatch(mobileBody, /label: "Edit"/);
  assert.doesNotMatch(mobileBody, /label: "Design"/);
  assert.match(mediaPanel, /studio-current-media/);
  assert.match(mediaPanel, /Upload image/);
  assert.match(mediaPanel, /Replace/);
  assert.match(mediaPanel, /AssetUploadDropzone/);
  assert.match(mediaPanel, /capturePagePaste/);
  assert.doesNotMatch(mediaPanel, /Auto fit all ad sizes|Auto fit current size|studio-image-repair-actions/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "templates"/);
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

test("mobile flow no longer exposes a separate ad details sheet", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const styles = read("src/components/adstudio/styles.ts");

  assert.doesNotMatch(workbench, /mobileAdDetailsOpen/);
  assert.doesNotMatch(workbench, /renderCampaignPanel/);
  assert.doesNotMatch(workbench, /studio-mobile-campaign/);
  assert.match(styles, /grid-template-columns:repeat\(6,1fr\)/);
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
