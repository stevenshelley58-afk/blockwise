import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("onboarding page renders the wizard instead of redirecting to settings", () => {
  const source = readFileSync("src/app/(customer)/onboarding/page.tsx", "utf8");

  assert.doesNotMatch(source, /redirect\(/);
  assert.doesNotMatch(source, /\/settings/);
  assert.match(source, /requirePageSurfaceAccess\("self_serve"\)/);
  assert.match(source, /<OnboardingWizard/);
});

test("onboarding wizard completes the progressive website and Brand Pack path into first ad flow", () => {
  const wizard = readFileSync("src/components/onboarding/onboarding-wizard.tsx", "utf8");

  assert.match(wizard, /\/api\/workspace\/onboarding-market/);
  assert.match(wizard, /\/api\/adstudio\/brand-kits\/extract/);
  assert.match(wizard, /\/api\/adstudio\/brand-kits\/\$\{encodeURIComponent\(review\.id\)\}\/approve/);
  assert.match(wizard, /router\.push\("\/ad-studio\?first=1"\)/);
  assert.doesNotMatch(wizard, /\/campaigns/);
  assert.doesNotMatch(wizard, /Skip for now/);
});

test("new ad dialog explains trial credit use without requiring Meta", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");

  assert.match(dialog, /\/api\/trial\/status/);
  assert.match(dialog, /includedRenders/);
  assert.match(dialog, /Uses 2 of \$\{status\.includedRenders\} free renders/);
  assert.doesNotMatch(dialog, /10 free ad packs|includedAdPacks/);
  assert.match(dialog, /No Meta account is needed until publish/);
  assert.match(dialog, /AssetUploadDropzone/);
  assert.match(dialog, /capturePagePaste/);
});

test("onboarding scan failure preserves the website and offers a minimal canonical fallback", () => {
  const wizard = readFileSync("src/components/onboarding/onboarding-wizard.tsx", "utf8");

  assert.match(wizard, /setScanFailed\(true\)/);
  assert.match(wizard, /retry or add the essentials/);
  assert.match(wizard, /createManualBrandPack/);
  assert.match(wizard, /manualName/);
  assert.match(wizard, /manualColour/);
  assert.match(wizard, /escapeHtml\(manualName\.trim\(\)\)/);
  assert.doesNotMatch(wizard, /AssetUploadDropzone/);
});

test("landing CTA tracking fires cta_click for every CTA and BookDemoClick only for managed setup", () => {
  const ctaLink = readFileSync("src/components/landing/cta-link.tsx", "utf8");
  const pixel = readFileSync("src/lib/analytics/pixel.ts", "utf8");
  // The homepage renders from page.tsx plus the home-landing component tree.
  const homepage = [
    readFileSync("src/app/page.tsx", "utf8"),
    ...readdirSync("src/components/home-landing")
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .sort()
      .map((file) => readFileSync(path.join("src/components/home-landing", file), "utf8")),
  ].join("\n");

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
  const loader = readFileSync("src/lib/trial/trial-status.ts", "utf8");
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
  const statusRoute = readFileSync("src/app/api/trial/status/route.ts", "utf8");
  const campaignActions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");

  assert.match(pill, /blockwise:trial-status-refresh/);
  assert.match(campaignActions, /dispatchEvent\(new Event\("blockwise:trial-status-refresh"\)\)/);
  assert.match(pill, /status\.upgradeHref/);
  assert.match(loader, /FREE_TRIAL_RENDER_LIMIT = 6/);
  assert.match(loader, /RENDERS_PER_AD_PACK = 2/);
  assert.match(loader, /TRIAL_UPGRADE_HREF = "\/settings#billing"/);
  assert.match(appShell, /loadTrialStatus/);
  assert.match(statusRoute, /loadTrialStatus/);
  assert.doesNotMatch(`${appShell}\n${statusRoute}`, /adstudio_campaigns|INCLUDED_AD_PACKS|loadFallbackTrialStatus/);
});
