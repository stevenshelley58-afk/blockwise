import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("onboarding page renders the wizard instead of redirecting to settings", () => {
  const source = readFileSync("src/app/(customer)/onboarding/page.tsx", "utf8");

  assert.doesNotMatch(source, /redirect\(/);
  assert.doesNotMatch(source, /\/settings/);
  assert.match(source, /requirePageSurfaceAccess\("self_serve"\)/);
  assert.match(source, /<OnboardingWizard/);
});

test("onboarding wizard completes setup into first ad flow", () => {
  const wizard = readFileSync("src/components/onboarding/onboarding-wizard.tsx", "utf8");

  assert.match(wizard, /\/api\/workspace\/onboarding-status/);
  assert.match(wizard, /status: "complete"/);
  assert.match(wizard, /router\.push\("\/ad-studio\?first=1"\)/);
  assert.doesNotMatch(wizard, /\/campaigns/);
  assert.ok((wizard.match(/Skip for now/g) ?? []).length >= 3);
});

test("new ad dialog explains trial credit use without requiring Meta", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");

  assert.match(dialog, /\/api\/trial\/status/);
  assert.match(dialog, /includedAdPacks/);
  assert.match(dialog, /Uses 1 of \$\{status\.includedAdPacks\} free ad packs/);
  assert.doesNotMatch(dialog, /Uses 1 of 10 free ad packs/);
  assert.match(dialog, /No Meta account is needed until publish/);
  assert.match(dialog, /AssetUploadDropzone/);
  assert.match(dialog, /capturePagePaste/);
});

test("new ad dialog closes media sub-screens before closing the popup", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const closeHandlerStart = dialog.indexOf("const closeCurrentView = useCallback(() => {");
  const closeHandlerEnd = dialog.indexOf("useEffect(() => {", closeHandlerStart);
  const closeHandler = dialog.slice(closeHandlerStart, closeHandlerEnd);
  const escapeHandlerStart = dialog.indexOf('event.key === "Escape"');
  const escapeHandlerEnd = dialog.indexOf('if (event.key === "Tab")', escapeHandlerStart);
  const escapeHandler = dialog.slice(escapeHandlerStart, escapeHandlerEnd);
  const submitStart = dialog.indexOf("async function submit()");
  const submitEnd = dialog.indexOf("const stepTitle =", submitStart);
  const submitBody = dialog.slice(submitStart, submitEnd);

  assert.notEqual(closeHandlerStart, -1);
  assert.notEqual(closeHandlerEnd, -1);
  assert.notEqual(escapeHandlerStart, -1);
  assert.notEqual(escapeHandlerEnd, -1);
  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);
  assert.ok(closeHandler.includes('if (step === "brief" && mediaSourceMode !== "details") {'));
  assert.ok(closeHandler.includes('setMediaSourceMode("details");'));
  assert.ok(closeHandler.includes('setError("");'));
  assert.ok(closeHandler.includes("return;"));
  assert.ok(closeHandler.includes("onClose();"));
  assert.ok(closeHandler.includes("}, [mediaSourceMode, onClose, step]);"));
  assert.ok(escapeHandler.includes("closeCurrentView();"));
  assert.ok(
    dialog.includes(
      '<div className="studio-newad-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeCurrentView()}>',
    ),
  );
  assert.match(dialog, /aria-label="Close" onClick=\{closeCurrentView\}/);
  assert.match(dialog, /className="studio-btn secondary" type="button" onClick=\{closeCurrentView\}>Close<\/button>/);
  assert.ok(submitBody.includes("await onGenerate({"));
  assert.ok(submitBody.includes("imageSlotDataUrls: resolvedImageSlotDataUrls,"));
  assert.ok(submitBody.includes("onClose();"));

  assert.doesNotMatch(dialog, /aria-label="Close" onClick=\{onClose\}/);
  assert.doesNotMatch(dialog, /className="studio-btn secondary" type="button" onClick=\{onClose\}>Close<\/button>/);
});

test("onboarding logo upload previews flexible file input", () => {
  const wizard = readFileSync("src/components/onboarding/onboarding-wizard.tsx", "utf8");

  assert.match(wizard, /AssetUploadDropzone/);
  assert.match(wizard, /logoPreviewUrl/);
  assert.match(wizard, /capturePagePaste/);
});

test("landing CTA tracking fires cta_click for every CTA and BookDemoClick only for managed setup", () => {
  const ctaLink = readFileSync("src/components/landing/cta-link.tsx", "utf8");
  const pixel = readFileSync("src/lib/analytics/pixel.ts", "utf8");
  const homepage = readFileSync("src/app/page.tsx", "utf8");

  // Every CTA fires a cta_click with the location label.
  assert.match(ctaLink, /trackCtaClick\(location/);
  assert.match(pixel, /trackCustom", "cta_click"/);
  // Managed setup links also fire BookDemoClick for analytics continuity.
  assert.match(ctaLink, /if \(href === "#managed-setup"\)/);
  assert.match(ctaLink, /trackDemoCtaClick\(location\)/);
  // The hook is not a single arrow-onClick that fires only for managed setup.
  assert.doesNotMatch(ctaLink, /onClick=\{\(\) => trackDemoCtaClick\(location\)\}/);
  // The page still has both kinds of links.
  assert.match(homepage, /href="\/signup"/);
  assert.match(homepage, /href="#managed-setup"/);
});

test("trial pill refreshes from the first-ad generation event", () => {
  const pill = readFileSync("src/components/trial-status-pill.tsx", "utf8");
  const campaignActions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");

  assert.match(pill, /blockwise:trial-status-refresh/);
  assert.match(campaignActions, /dispatchEvent\(new Event\("blockwise:trial-status-refresh"\)\)/);
  assert.match(pill, /status\.upgradeHref/);
  assert.match(readFileSync("src/app/api/trial/status/route.ts", "utf8"), /\/settings#billing/);
});
