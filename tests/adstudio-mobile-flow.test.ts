import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("mobile nav exposes the canvas-first Ad Studio sections", () => {
  const mobileBody = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");
  const navBlocks = `${mobileBody.match(/const NAV_ITEMS:[\s\S]*?\];/)?.[0] ?? ""}\n${mobileBody.match(/const MOBILE_NAV_IDS[\s\S]*?\);/)?.[0] ?? ""}`;

  assert.match(mobileBody, /studio\.mobileTab === "home"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "media"/);
  assert.match(mobileBody, /href: "\/ad-studio\/library"/);
  assert.match(mobileBody, /studio\.mobileTab === "text"/);
  assert.match(mobileBody, /label: "Home"/);
  assert.match(mobileBody, /label: "Create"/);
  assert.match(mobileBody, /samplePickerOpen/);
  assert.match(mobileBody, /label: "Library"/);
  assert.match(mobileBody, /label: "Text"/);
  assert.match(mobileBody, /label: "Publish"/);
  assert.match(mobileBody, /const MOBILE_NAV = NAV_ITEMS\.filter/);
  assert.doesNotMatch(mobileBody, /label: "Review"/);
  assert.match(mobileBody, /label: "Brand Pack"/);
  assert.match(mobileBody, /label: "Settings"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "campaign"/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "design"/);
  assert.doesNotMatch(navBlocks, /label: "Edit"/);
  assert.doesNotMatch(navBlocks, /label: "Design"/);
  assert.match(mediaPanel, /studio-current-media/);
  assert.match(mediaPanel, /Upload image/);
  assert.match(mediaPanel, /Replace/);
  assert.match(mediaPanel, /AssetUploadDropzone/);
  assert.match(mediaPanel, /capturePagePaste/);
  assert.doesNotMatch(mediaPanel, /Auto fit all ad sizes|Auto fit current size|studio-image-repair-actions/);
  assert.doesNotMatch(mobileBody, /studio\.mobileTab === "samples"/);
});

test("media library stages a replacement and confirms before generating a new ad", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");
  const editClient = read("src/components/adstudio/canvas/creative-edit-client.ts");

  assert.match(mediaPanel, /selectedImageSrc/);
  assert.match(mediaPanel, /Selected replacement/);
  assert.match(mediaPanel, /Replace image/);
  assert.match(mediaPanel, /Generate a new ad with this image\?/);
  assert.match(mediaPanel, /Generate new ad/);
  assert.match(mediaPanel, /<DialogContent/);
  // The tile is keyed by the thumbnail `src`; the re-generation consumes `fullSrc`.
  assert.match(workbench, /setPendingMediaReplacement\(\{ src, fullSrc: asset\.fullSrc, label: asset\.label \}\)/);
  assert.match(workbench, /currentCreative\.canvas\.cloneQa\?\.regions\.find\(\(region\) => region\.kind === "image"\)/);
  assert.match(workbench, /requestCreativeEdit\(\{/);
  assert.match(workbench, /newImage: pendingMediaReplacement\.fullSrc/);
  assert.match(editClient, /expectedRevisionId: creative\.activeRevisionId/);
  assert.match(editClient, /objects: \[\{ \.\.\.cloneObject, content: data\.previewDataUrl \?\? data\.image, assetId: data\.image \}\]/);
});

test("media library filters assets by role without a generated ads tab", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const mediaPanel = read("src/components/adstudio/panels/media-panel.tsx");

  assert.match(mediaPanel, /studio-library-filters/);
  assert.match(mediaPanel, /resolveRole/);
  assert.match(mediaPanel, /All <span>\{mediaAssets\.length\}<\/span>/);
  assert.match(mediaPanel, /ROLE_META\[role\]\.plural/);
  assert.doesNotMatch(mediaPanel, /generatedAds/);
  assert.doesNotMatch(mediaPanel, /LibraryView/);
  assert.doesNotMatch(workbench, /creativeLibraryPreview/);
  assert.doesNotMatch(workbench, /onSelectGeneratedAd/);
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
  assert.match(styles, /grid-template-columns:repeat\(5,minmax\(56px,1fr\)\)/);
  assert.match(workbench, /studio\.saveState !== "saved"/);
});

test("Brand Pack and campaign settings have separate desktop and mobile sections", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const studioState = read("src/components/adstudio/use-ad-studio.ts");

  assert.match(studioState, /StudioSection[\s\S]*\| "brand"[\s\S]*\| "settings"/);
  assert.match(studioState, /MobileTab[\s\S]*"brand"[\s\S]*"settings"/);
  assert.match(workbench, /if \(studio\.section === "brand"\) \{[\s\S]*return <BrandPanel/);
  assert.match(workbench, /if \(studio\.section === "settings"\) \{[\s\S]*return \([\s\S]*<SettingsPanel/);
  assert.match(workbench, /studio\.mobileTab === "brand"[\s\S]*<BrandPanel/);
  assert.match(workbench, /studio\.mobileTab === "settings"[\s\S]*<SettingsPanel/);
  assert.doesNotMatch(
    workbench,
    /studio\.mobileTab === "settings"[\s\S]{0,180}<BrandPanel/,
  );
  assert.match(workbench, /if \(item\.id === "brand"\)[\s\S]*brandKit\.reviewStatus/);
});

test("mobile preview uses the same creative editor surface as desktop", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");
  const styles = read("src/components/adstudio/styles.ts");

  assert.match(workbench, /const MOBILE_WORKBENCH_QUERY = "\(max-width: 900px\)";/);
  assert.match(workbench, /function renderCreativeEditor\(\) \{[\s\S]*<InPlaceAdEditor/);
  assert.match(workbench, /!isMobileViewport \? renderCreativeEditor\(\) : null/);
  assert.match(workbench, /studio-mobile-preview-wrap[\s\S]*\{renderCreativeEditor\(\)\}/);
  assert.doesNotMatch(workbench, /renderFallbackPreview/);
  assert.match(styles, /studio-mobile-preview-wrap/);
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

test("mobile overflow exposes Brand Pack and campaign settings", () => {
  const topbar = read("src/components/adstudio/topbar.tsx");
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");

  assert.match(topbar, /onOpenBrand/);
  assert.match(topbar, /Brand Pack/);
  assert.match(topbar, /onOpenSettings/);
  assert.match(topbar, /Campaign settings/);
  assert.match(workbench, /onOpenBrand=\{\(\) => goToSection\("brand"\)\}/);
  assert.match(workbench, /onOpenSettings=\{\(\) => goToSection\("settings"\)\}/);
});
