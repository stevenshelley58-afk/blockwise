import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// P2.2 — the primary stage shows a clone creative exactly as Meta renders it:
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
  // Page header: brand avatar initial + name + Sponsored.
  assert.match(preview, /<small>Sponsored<\/small>/);
  assert.match(preview, /brandKit\.identity\.businessName/);
  // Primary text sits before the embedded creative; the strip follows in a footer.
  const primaryIndex = preview.indexOf('className="studio-feed-primary studio-metachrome-copy"');
  const mediaIndex = preview.indexOf('<div className="studio-metachrome-media">{children}</div>');
  const footerIndex = preview.indexOf('className="studio-feed-headline studio-metachrome-copy"');
  assert.ok(primaryIndex > -1 && mediaIndex > -1 && footerIndex > -1);
  assert.ok(primaryIndex < mediaIndex && mediaIndex < footerIndex, "order must be primary text, creative, headline strip");
});

test("chrome copy is the LIVE copy state, not re-derived from the pack", () => {
  assert.match(preview, /\{copy\.primaryText\}/);
  assert.match(preview, /\{copy\.headline\}/);
  assert.match(preview, /\{copy\.description\}/);
  // Workbench passes its live copy state straight through.
  assert.match(workbench, /<MetaChromePreview[\s\S]*?copy=\{copy\}[\s\S]*?>/);
});

test("primary text and headline/description click through to the Text panel", () => {
  const copyButtons = preview.match(/studio-metachrome-copy" type="button" onClick=\{onSelectText\}/g) ?? [];
  assert.equal(copyButtons.length, 3, "primary text, headline and description are all clickable");
  assert.match(workbench, /onSelectText=\{\(\) => goToSection\("text"\)\}/);
});

test("workbench wraps the in-place editor in MetaChromePreview for clone creatives only", () => {
  assert.match(workbench, /if \(isCloneCreative\(currentCreative\)\) \{\s*return \(\s*<MetaChromePreview/);
  assert.match(workbench, /<MetaChromePreview[\s\S]*?<InPlaceAdEditor[\s\S]*?creative=\{currentCreative\}[\s\S]*?<\/MetaChromePreview>/);
  // Non-clone creatives keep the Fabric layer editor unchanged.
  assert.match(workbench, /<FabricAdEditor\s+brandKit=\{brandKit\}/);
});

test("story chrome overlays avatar, Sponsored, progress bars and CTA pill without blocking edits", () => {
  assert.match(preview, /studio-metachrome-story-chrome/);
  assert.match(preview, /studio-metachrome-story-progress/);
  assert.match(preview, /className="studio-story-cta studio-metachrome-story-cta"/);
  // Overlay must never swallow clicks meant for the in-place edit regions.
  assert.match(styles, /\.studio-metachrome-story-chrome\{[^}]*pointer-events:none/);
});

test("meta chrome styles reuse the feed/story card visual language", () => {
  assert.match(preview, /className="studio-feed-card studio-metachrome-card"/);
  assert.match(preview, /className="studio-story-brand studio-metachrome-story-brand"/);
  assert.match(styles, /\.studio-metachrome-card\{/);
  assert.match(styles, /\.studio-metachrome-media\{/);
  // Embedded editor renders edge-to-edge inside the card like a real feed unit.
  assert.match(styles, /\.studio-metachrome-media \.studio-inplace-frame img[^}]*width:100%[^}]*border-radius:0/);
});
