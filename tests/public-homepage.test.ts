import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  formatBillingAmount,
  getBillingOffer,
} from "../src/lib/billing/offers.ts";

// Follow the active homepage imports deliberately. The home-landing directory
// also owns dormant feature sections that are not rendered by src/app/page.tsx.
const ACTIVE_HOME_SOURCES = [
  "src/components/home-landing/site-chrome.tsx",
  "src/components/home-landing/night-ops-hero.tsx",
  "src/components/home-landing/home-sections.tsx",
  "src/components/home-landing/start-studio.tsx",
  "src/components/home-landing/data.ts",
  "src/components/home-landing/fb-ad-card.tsx",
  "src/components/home-landing/faq-accordion.tsx",
  "src/components/home-landing/managed-setup-form.tsx",
] as const;

function readHomeSources(): { page: string; combined: string } {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const parts = ACTIVE_HOME_SOURCES.map((file) => readFileSync(file, "utf8"));
  return { page, combined: [page, ...parts].join("\n") };
}

test("public homepage does not redirect anonymous visitors to the login screen", () => {
  const { page, combined } = readHomeSources();

  assert.doesNotMatch(page, /redirect\(/);
  // Signup flow stays reachable; wording of buttons/sections is free to change.
  assert.match(combined, /href="\/signup"/);
  // C5: sign-in stays in its own component so Space-key activations scroll the
  // page rather than navigating to /login. Label text itself is not pinned.
  assert.match(combined, /SignInLink/);
});

test("public audit report route stays public and off the protected Ad Radar surface", () => {
  // The redesigned homepage no longer embeds the live suburb scan, but the
  // public /audit flow it fed still exists and must keep its public posture.
  const form = readFileSync("src/components/research/ad-radar-location-form.tsx", "utf8");
  const route = readFileSync("src/app/api/research/local-ad-radar/route.ts", "utf8");

  assert.match(form, /event\.preventDefault\(\)/);
  assert.doesNotMatch(
    route,
    /requireWorkspaceAccess|requirePageSurfaceAccess|v_agent_ad_history|createSupabaseServerClient/,
  );
  assert.match(route, /createSupabaseServiceClient/);
  assert.match(route, /featureDisabledResponse\("adRadar", "suburbPages"\)/);
});

test("landing page anchors, sections, and claims stay connected", () => {
  const { page, combined } = readHomeSources();
  const oldProductName = new RegExp("Aur" + "alis", "i");
  const deadAnchor = new RegExp('href="' + '#"');
  const staleSignupAnchor = 'href="#sig' + 'nup"';
  const forbiddenClaims = new RegExp(
    [
      "Meta-" + "compliant",
      "guaranteed " + "compliant",
      "guaranteed " + "leads",
      "legal " + "advice",
      "full DA " + "assessment",
      "everything you " + "need",
      "council-" + "approved",
      "definitive",
      "reach them " + "first",
      "R" + "OI",
    ].join("|"),
    "i",
  );

  assert.doesNotMatch(combined, oldProductName);
  assert.doesNotMatch(combined, deadAnchor);
  assert.doesNotMatch(combined, new RegExp(staleSignupAnchor));
  assert.doesNotMatch(combined, forbiddenClaims);

  // One section element per anchor id; both breakpoint variants render inside
  // it, so every anchor resolves at desktop and mobile widths. The former
  // #updates band was merged into #control and the self-serve price panel
  // ships as #pricing between #free-trial and #managed-setup.
  const expectedSections = [
    "top",
    "start",
    "workflow",
    "control",
    "free-trial",
    "pricing",
    "managed-setup",
    "faq",
  ];

  for (const id of expectedSections) {
    assert.match(page, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  let previousIndex = -1;
  for (const id of expectedSections) {
    const index = page.indexOf(`id="${id}"`);
    assert.ok(index > previousIndex, `#${id} should appear after the previous major section`);
    previousIndex = index;
  }

  assert.match(combined, /Your competitors are[\s\S]{0,80}advertising\./);
  assert.match(combined, /Choose a real-estate ad layout/);
  assert.doesNotMatch(
    combined,
    /daily emails?|proven|top-performing|everything included|what(?:&rsquo;|')s actually working/i,
  );

  const ids = [...combined.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "landing and setup form IDs must be unique");

  const localAnchors = [...combined.matchAll(/href="#([A-Za-z0-9_-]+)"/g)].map(
    (match) => match[1],
  );
  for (const target of localAnchors) {
    assert.ok(ids.includes(target), `#${target} anchor must target an existing ID`);
  }

  assert.match(combined, /href="\/#free-trial"/);
  // The walkthrough CTAs use CtaLink's default #managed-setup target.
  assert.match(combined, /location="faq_walkthrough"/);
});

test("landing page local image assets resolve from public/", () => {
  const { combined } = readHomeSources();
  const assets = [
    ...combined.matchAll(/(?:src|photoSrc)=(?:"|\{")(\/(?:hero|ads|home)\/[^"]+)"/g),
  ].map((match) => match[1]);

  assert.ok(assets.length > 0, "homepage should reference bundled /home assets");
  for (const asset of assets) {
    assert.ok(existsSync(path.join("public", asset.slice(1))), `${asset} should exist under public/`);
  }
});

test("landing page metadata matches Blockwise positioning", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const home = readFileSync("src/app/page.tsx", "utf8");
  const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");

  assert.match(layout, /Blockwise \| Real Estate Meta Ads Workflow/);
  assert.match(layout, /Create, approve, publish, and track Meta ad campaigns through your own ad account/);
  assert.match(layout, /type:\s*"website"/);
  assert.match(layout, /card:\s*"summary_large_image"/);
  assert.doesNotMatch(layout, /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/);
  assert.match(home, /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/);
  assert.match(pricing, /alternates:\s*\{\s*canonical:\s*"\/pricing"\s*\}/);
});

test("public marketing copy states the approved progressive offer", () => {
  const { combined: home } = readHomeSources();
  const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const combined = `${home}\n${pricing}\n${layout}`;

  assert.match(home, /Nothing spends before approval/i);
  assert.match(home, /Stay in control/i);
  assert.match(home, /Approve every ad before it goes live/i);
  assert.match(home, /Create three complete ads free/i);
  assert.match(home, /Email only\. No card\./i);
  assert.match(pricing, /Create three complete Feed \+ Story ads with only your email/i);
  assert.match(pricing, /Meta ad spend is separate/i);
  assert.doesNotMatch(combined, /\$799/);
  assert.doesNotMatch(combined, /Launch from Blockwise/);
  assert.doesNotMatch(combined, /create, approve, launch/i);
  assert.doesNotMatch(combined, /To launch from Blockwise/i);
});

test("homepage CTA notes stay grouped and centered beneath their buttons", () => {
  const sections = readFileSync("src/components/home-landing/home-sections.tsx", "utf8");
  const heroCss = readFileSync("src/components/home-landing/night-ops-hero.css", "utf8");
  const homepageCss = readFileSync("src/app/homepage.css", "utf8");

  assert.match(
    sections,
    /className="hw-trial-cta"[\s\S]*className="hw-btn hw-btn--dark"[\s\S]*Email only\. No card\./,
  );
  assert.match(heroCss, /\.hw-no-form\s*\{[^}]*display:\s*inline-grid;[^}]*justify-items:\s*center;/);
  assert.match(homepageCss, /\.hw-trial-cta\s*\{[^}]*display:\s*inline-grid;[^}]*justify-items:\s*center;/);
});

test("homepage FAQ matches the approved flat-rate offer", () => {
  const faq = readFileSync("src/components/home-landing/data.ts", "utf8");
  const selfServe = getBillingOffer("AU", "self_serve");
  const managed = getBillingOffer("AU", "managed");

  assert.match(faq, /pay Meta directly/i);
  assert.match(faq, /full control of your spend/i);
  assert.match(faq, /campaign data stays with you/i);
  assert.match(faq, /guide you through the setup/i);
  assert.match(faq, /Nothing launches until you approve/i);
  assert.match(faq, /Three complete Feed \+ Story ads, free/i);
  assert.match(faq, /starts when your first campaign goes live/i);
  assert.match(faq, /seven days after checkout/i);
  assert.equal(formatBillingAmount(selfServe.firstInvoiceAmount, selfServe.currency), "A$99");
  assert.equal(formatBillingAmount(selfServe.recurringAmount, selfServe.currency), "A$499");
  assert.equal(formatBillingAmount(managed.recurringAmount, managed.currency), "A$1,500");
  assert.match(faq, /weekly optimisation for up to four campaigns/i);
  assert.match(faq, /technical and creative advice/i);
  assert.match(faq, /Cancel anytime/i);
  assert.match(faq, /No AI slop/i);
  assert.match(faq, /copy, headlines and descriptions/i);
  assert.match(faq, /your suburb/i);
  assert.match(faq, /getBillingOffer/);
  assert.doesNotMatch(faq, /US\$99|A\$99|US\$499|A\$499|US\$1,500|A\$2,500/);
});

test("pricing keeps US and AU offers explicit and accessible", () => {
  const pricingPage = readFileSync("src/app/pricing/page.tsx", "utf8");
  const pricing = readFileSync("src/components/pricing/market-pricing.tsx", "utf8");
  const combined = `${pricingPage}\n${pricing}`;

  assert.match(pricing, /aria-pressed=\{market === value\}/);
  assert.match(pricing, /Choose your market/);
  assert.match(pricing, /United States/);
  assert.match(pricing, /Australia/);
  assert.match(pricing, /getBillingOffer/);
  assert.match(pricing, /formatBillingAmount/);
  assert.match(pricing, /in either market/);
  assert.doesNotMatch(pricing, /["'`]US\$[0-9]|["'`]A\$[0-9]/);
  assert.match(combined, /100 render credits/);
  assert.match(combined, /Up to 50 complete Feed \+ Story packs/);
  assert.match(combined, /Five named, email-verified team members/);
  assert.match(combined, /One free live campaign setup/);
  assert.match(combined, /Subscribe and book onboarding/);
  assert.match(combined, /Book a call first/);
});

test("managed-setup form posts to the demo-request endpoint with an intact honeypot", () => {
  const form = readFileSync("src/components/home-landing/managed-setup-form.tsx", "utf8");
  const route = readFileSync("src/app/api/demo-request/route.ts", "utf8");

  assert.match(form, /\/api\/demo-request/);
  // company_website is the API's spam honeypot: it must stay in the form,
  // stay visually hidden, and never be a user-facing field.
  assert.match(form, /name="company_website"/);
  assert.match(form, /hw-ms-hp/);
  assert.match(route, /company_website/);
});

test("legal pages rely on root title template and define page canonicals", () => {
  const legalPages = [
    ["src/app/(legal)/privacy/page.tsx", "Privacy Policy", "/privacy"],
    ["src/app/(legal)/terms/page.tsx", "Terms of Service", "/terms"],
    ["src/app/(legal)/data-deletion/page.tsx", "Data Deletion", "/data-deletion"],
  ] as const;

  for (const [file, title, canonical] of legalPages) {
    const source = readFileSync(file, "utf8");
    assert.match(source, new RegExp(`title:\\s*"${title}"`));
    assert.doesNotMatch(source, /title:\s*"[^"]*(?:·|Â·)\s*Blockwise"/);
    assert.match(source, new RegExp(`alternates:\\s*\\{\\s*canonical:\\s*"${canonical}"\\s*\\}`));
  }
});

test("terms separate free creation from the post-Checkout billing trial", () => {
  const terms = readFileSync("src/app/(legal)/terms/page.tsx", "utf8");

  assert.match(terms, /free creation allowance includes three complete Feed and Story ads before Checkout/i);
  assert.match(terms, /starts a separate[\s\S]*seven-day billing trial/i);
  assert.match(terms, /first campaign[\s\S]*launches or that billing trial ends/i);
  assert.match(terms, /getBillingOffer/);
  assert.doesNotMatch(terms, /One live campaign setup is free/i);
});

test("public pages identify the legal operator in server-rendered content", () => {
  const legalName = "SHELLEY, STEVEN JOHN";
  const { combined } = readHomeSources();

  assert.match(combined, new RegExp(legalName), "homepage must identify the legal operator");

  const publicPages = [
    "src/app/(legal)/privacy/page.tsx",
    "src/app/(legal)/terms/page.tsx",
    "src/app/(legal)/layout.tsx",
  ];

  for (const file of publicPages) {
    assert.match(
      readFileSync(file, "utf8"),
      new RegExp(legalName),
      `${file} must identify the legal operator`,
    );
  }

  const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
  assert.match(pricing, /<SiteFooter \/>/, "pricing must render the shared legal footer");
});

test("robots and 404 keep protected routes out of search and anonymous visitors on public home", () => {
  const robots = readFileSync("src/app/robots.ts", "utf8");
  const notFound = readFileSync("src/app/not-found.tsx", "utf8");

  for (const route of ["/home", "/settings", "/pwa", "/reset-password", "/forgot-password", "/property-check"]) {
    assert.match(robots, new RegExp(`"${route}"`));
  }

  // The 404 offers both recovery paths. It was ported off the legacy
  // `.button secondary` class (globals.css is unlayered and would override the
  // token styling), so assert the links, not the class name.
  assert.match(notFound, /href="\/"[\s\S]*Back to home/);
  assert.match(notFound, /href="\/self-serve"[\s\S]*Go to dashboard/);
});

test("production login page does not expose development test profiles or passwords", () => {
  const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
  const loginForm = readFileSync("src/components/login-form.tsx", "utf8");

  assert.match(loginPage, /showTestProfiles=\{process\.env\.NODE_ENV !== "production"\}/);
  assert.match(loginForm, /showTestProfiles/);
  assert.doesNotMatch(loginPage, /SJS5858/);
  assert.doesNotMatch(loginForm, /SJS5858/);
  assert.doesNotMatch(loginPage, /Dev login/);
});

test("test user seeding requires an explicit non-default password", () => {
  const seedScript = readFileSync("scripts/seed-test-users.mjs", "utf8");

  assert.match(seedScript, /BLOCKWISE_DEV_PASSWORD/);
  assert.match(seedScript, /password\.length < 16/);
  assert.doesNotMatch(seedScript, /SJS5858/);
});
