import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The primary stage shows a clone creative exactly as Meta renders it:
// page header, live primary text above the creative, the embedded in-place
// editor as the creative, then headline/description strip + real CTA button.
const preview = readFileSync("src/components/adstudio/preview.tsx", "utf8");
const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const styles = readFileSync("src/components/adstudio/styles.ts", "utf8");

test("MetaChromePreview exists and shows the real Meta CTA enum label", () => {
  assert.match(preview, /export function MetaChromePreview\(/);
  // The button label comes from the actual enum, never the raw copy string.
  assert.match(preview, /labelForMetaCta\(toMetaCta\(copy\.cta\)\)/);
  assert.match(preview, /from "@\/lib\/adstudio\/meta-cta"/);
  assert.match(preview, /\{ctaLabel\}/);
});

test("feed chrome renders header, primary text ABOVE the creative, then the headline strip", () => {
  // Page header: advertiser avatar/logo + name + Sponsored.
  assert.match(preview, /<small>Sponsored<\/small>/);
  assert.match(preview, /function MetaAvatar/);
  assert.match(preview, /brandKit\.logos\.primaryLogoUrl \|\| brandKit\.logos\.faviconUrl/);
  assert.match(preview, /brandKit\.identity\.tradingName\?\.trim\(\) \|\| brandKit\.identity\.businessName/);
  // Primary text sits before the embedded creative; the strip follows in a footer.
  const primaryIndex = preview.indexOf('className="studio-feed-primary studio-metachrome-copy"');
  const mediaIndex = preview.indexOf('<div className="studio-metachrome-media">{children}</div>');
  const footerIndex = preview.indexOf('className="studio-feed-headline studio-metachrome-copy"');
  assert.ok(primaryIndex > -1 && mediaIndex > -1 && footerIndex > -1);
  assert.ok(primaryIndex < mediaIndex && mediaIndex < footerIndex, "order must be primary text, creative, headline strip");
});

test("chrome copy is the LIVE copy state, not re-derived from the pack", () => {
  assert.match(preview, /formatMetaPrimaryText\(copy\.primaryText\)/);
  assert.match(preview, /\{copy\.headline\}/);
  assert.match(preview, /\{copy\.description\}/);
  // Workbench passes its live copy state straight through.
  assert.match(workbench, /<MetaChromePreview[\s\S]*?copy=\{copy\}[\s\S]*?>/);
});

test("primary text, headline, description and CTA open their exact Edit field", () => {
  assert.match(preview, /onSelectText\?\.\("primaryText"\)/);
  assert.match(preview, /onSelectText\?\.\("headline"\)/);
  assert.match(preview, /onSelectText\?\.\("description"\)/);
  assert.match(preview, /onSelectText\?\.\("cta"\)/);
  assert.match(preview, /data-selected=\{selectedElement === "headline"/);
  assert.match(workbench, /onSelectText=\{selectMetaCopyField\}/);
  assert.match(workbench, /selectedElement=\{selectedElement\}/);
});

test("workbench wraps the post-clone editor in Meta chrome", () => {
  // Track B: the in-place editor is extracted once and wrapped by either the
  // v2 MetaFrame (flag on) or the legacy MetaChromePreview (flag off) — both
  // live inside the clone editor stage with PreviewFit scaling.
  assert.match(workbench, /if \(isCloneCreative\(currentCreative\)\) \{/);
  assert.match(workbench, /const cloneEditor = \(\s*<InPlaceAdEditor/);
  assert.match(workbench, /const frameChrome = useV2Frames \? \(\s*<MetaFrame/);
  assert.match(workbench, /<MetaChromePreview/);
  assert.match(workbench, /\{cloneEditor\}\s*<\/MetaChromePreview>/);
  assert.match(workbench, /\{frameChrome\}\s*<\/PreviewFit>/);
  assert.doesNotMatch(workbench, /FabricAdEditor|fabric-ad-editor/);
});

test("desktop preview fits the complete Meta ad inside the stage without an internal scrollbar", () => {
  assert.match(workbench, /function PreviewFit/);
  assert.match(workbench, /new ResizeObserver\(fit\)/);
  assert.match(workbench, /Math\.min\(1, frame\.clientWidth \/ contentWidth, frame\.clientHeight \/ contentHeight\)/);
  assert.match(workbench, /<PreviewFit enabled=\{!isMobileViewport\}>/);
  assert.match(styles, /\.studio-preview-fit\{[^}]*height:100%[^}]*overflow:hidden/);
  assert.match(styles, /\.studio-metachrome\{overflow:visible/);
  assert.doesNotMatch(styles, /\.studio-metachrome\{[^}]*overflow:auto/);
});

test("story chrome overlays avatar, Sponsored, progress bars and CTA pill without blocking edits", () => {
  assert.match(preview, /studio-metachrome-story-chrome/);
  assert.match(preview, /studio-metachrome-story-progress/);
  assert.match(preview, /className="studio-story-cta studio-metachrome-story-cta"/);
  assert.match(preview, /Learn more/);
  // Overlay must never swallow clicks meant for the in-place edit regions.
  assert.match(styles, /\.studio-metachrome-story-chrome\{[^}]*pointer-events:none/);
});

test("meta chrome styles match the light Meta feed unit and keep app UI off the creative", () => {
  assert.match(preview, /className="studio-feed-card studio-metachrome-card"/);
  assert.match(preview, /className="studio-story-brand studio-metachrome-story-brand"/);
  assert.match(styles, /\.studio-metachrome-card\{/);
  assert.match(styles, /font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif/);
  assert.match(styles, /\.studio-metachrome-card \.studio-meta-avatar\{width:40px;height:40px/);
  assert.match(styles, /\.studio-metachrome-card \.studio-feed-primary\{[^}]*font-size:15px[^}]*white-space:pre-line/);
  assert.match(styles, /\.studio-metachrome-card footer\{[^}]*background:#f0f2f5/);
  assert.match(styles, /\.studio-metachrome-card \.studio-feed-cta\{[^}]*background:#e4e6eb[^}]*color:#050505/);
  assert.match(styles, /\.studio-metachrome-media\{/);
  // Embedded editor renders edge-to-edge inside the card like a real feed unit.
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-frame img[^}]*width:100%[^}]*border-radius:0/);
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-hint,\.studio-metachrome-media \.studio-inplace-undo\{display:none\}/);
  assert.match(workbench, /studio-metachrome-edit-hint/);
});

test("meta chrome enforces the selected placement ratio instead of inheriting the raster ratio", () => {
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-frame,\.studio-metachrome-media \.studio-clone-stage\{[^}]*aspect-ratio:4\/5[^}]*overflow:hidden/);
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-frame img,\.studio-metachrome-media \.studio-clone-stage img\{[^}]*height:100%[^}]*object-fit:cover/);
  assert.match(styles, /\.studio-metachrome-story\{[^}]*aspect-ratio:9\/16[^}]*overflow:hidden/);
  assert.match(styles, /\.studio-metachrome-story \.studio-inplace-frame,\.studio-metachrome-story \.studio-clone-stage\{[^}]*width:100%[^}]*height:100%/);
  assert.match(styles, /\.studio-metachrome-story \.studio-inplace-frame img,\.studio-metachrome-story \.studio-clone-stage img\{[^}]*width:100%[^}]*height:100%[^}]*object-fit:cover/);
});

test("feed chrome uses advertiser domain resolution and a setup nudge, never a Blockwise fallback", () => {
  assert.match(preview, /resolveAdvertiserDomain\(\{ brandKit, finalUrls: \[destinationUrl\] \}\)/);
  assert.match(preview, /studio-metachrome-nudge/);
  assert.doesNotMatch(preview, /blockwise\.sale/i);
});
