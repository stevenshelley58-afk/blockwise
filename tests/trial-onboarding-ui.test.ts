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

test("first-ad generation stays available before the Meta publish step", () => {
  const flow = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");
  const createSection = flow.slice(flow.indexOf("async function createAd"), flow.indexOf("const updateCreative"));

  assert.match(createSection, /await generateFirstAd\(input\)/);
  assert.doesNotMatch(createSection, /publish-readiness|Meta account|provider/);
  assert.match(flow, /type Stage = "create" \| "edit" \| "publish"/);
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
