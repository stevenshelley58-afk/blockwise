import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// The homepage renders from src/app/page.tsx plus the home-landing component
// tree (desktop + mobile variants of every section). Guards that used to read
// page.tsx alone now read the combined homepage source.
const HOME_LANDING_DIR = "src/components/home-landing";

function readHomeSources(): { page: string; combined: string } {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const parts = readdirSync(HOME_LANDING_DIR)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .sort()
    .map((file) => readFileSync(path.join(HOME_LANDING_DIR, file), "utf8"));
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
    "property-check",
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

  assert.match(combined, /Your competitors are advertising\. Are&nbsp;you\?/);
  assert.match(
    combined,
    /Ads built from what&rsquo;s actually working in your area\. Start getting leads today\./,
  );
  assert.match(combined, /Know the property before the call/);
  assert.match(combined, /Run a property check/);

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

  assert.match(home, /Nothing spends until you approve/i);
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

test("homepage FAQ matches the approved flat-rate offer", () => {
  const faq = readFileSync("src/components/home-landing/data.ts", "utf8");

  assert.match(faq, /pay Meta directly/i);
  assert.match(faq, /Connect Meta when you want to go live/i);
  assert.match(faq, /Nothing launches until you approve/i);
  assert.match(faq, /Three complete Feed \+ Story ads, free/i);
  assert.match(faq, /\$499\/mo from your first campaign launch/i);
  assert.match(faq, /Cancel anytime/i);
  assert.match(faq, /\$2,000\/mo flat, plus ad spend/i);
  assert.match(faq, /weekly optimization for up to four campaigns/i);

  // The flat-rate homepage FAQ must not resurrect dual-currency offers.
  assert.doesNotMatch(faq, /US\$/);
  assert.doesNotMatch(faq, /A\$/);
});

test("pricing keeps US and AU offers explicit and accessible", () => {
  const pricingPage = readFileSync("src/app/pricing/page.tsx", "utf8");
  const pricing = readFileSync("src/components/pricing/market-pricing.tsx", "utf8");
  const combined = `${pricingPage}\n${pricing}`;

  assert.match(pricing, /aria-pressed=\{market === value\}/);
  assert.match(pricing, /Choose your market/);
  assert.match(pricing, /United States/);
  assert.match(pricing, /Australia/);
  assert.match(pricing, /US\$99/);
  assert.match(pricing, /US\$499/);
  assert.match(pricing, /A\$99/);
  assert.match(pricing, /A\$499/);
  assert.match(pricing, /US\$1,500/);
  assert.match(pricing, /A\$2,500/);
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
