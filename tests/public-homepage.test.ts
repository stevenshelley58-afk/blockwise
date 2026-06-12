import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("public homepage does not redirect anonymous visitors to the login screen", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");

  assert.doesNotMatch(source, /redirect\(/);
  // Signup flow stays reachable; wording of buttons/sections is free to change.
  assert.match(source, /href="\/signup"/);
  // C5: sign-in stays in its own component so Space-key activations scroll the
  // page rather than navigating to /login. Label text itself is not pinned.
  assert.match(source, /SignInLink/);
});

test("homepage suburb scan opens the public ad popup instead of the protected Ad Radar page", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  const scan = readFileSync("src/components/research/landing-ad-radar-scan.tsx", "utf8");
  const form = readFileSync("src/components/research/ad-radar-location-form.tsx", "utf8");
  const route = readFileSync("src/app/api/research/local-ad-radar/route.ts", "utf8");
  const landingCards = readFileSync("src/components/research/landing-radar-cards.tsx", "utf8");

  assert.match(source, /LandingAdRadarScan/);
  assert.match(source, /LandingRadarCards/);
  assert.doesNotMatch(source, /Coastline Property|Hillview Agents|Northstar Realty|\/ads\/ad-/);
  assert.match(scan, /PublicAdRadarDialog/);
  assert.match(landingCards, /\/api\/research\/locations\/guess/);
  assert.match(landingCards, /\/api\/research\/local-ad-radar/);
  assert.match(scan, /onSearch=\{openScan\}/);
  assert.match(form, /event\.preventDefault\(\)/);
  assert.doesNotMatch(source, /AdRadarLocationForm/);
  assert.doesNotMatch(route, /requireWorkspaceAccess|requirePageSurfaceAccess|v_agent_ad_history|createSupabaseServerClient/);
  assert.match(route, /createSupabaseServiceClient/);
});

test("landing page anchors, sections, and claims stay connected", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  const demoForm = readFileSync("src/components/landing/demo-form.tsx", "utf8");
  const combined = `${source}\n${demoForm}`;
  const oldProductName = new RegExp("Aur" + "alis", "i");
  const deadAnchor = new RegExp('href="' + '#"');
  const staleSignupAnchor = "#sig" + "nup";
  const forbiddenClaims = new RegExp(
    [
      "Meta-" + "compliant",
      "guaranteed " + "compliant",
      "guaranteed " + "leads",
      "reach them " + "first",
      "R" + "OI",
    ].join("|"),
    "i",
  );

  assert.doesNotMatch(source, oldProductName);
  assert.doesNotMatch(source, deadAnchor);
  assert.doesNotMatch(source, new RegExp(staleSignupAnchor));
  assert.doesNotMatch(source, forbiddenClaims);

  const expectedSections = [
    "problem",
    "radar",
    "workflow",
    "campaign-types",
    "approval",
    "reporting",
    "free-trial",
    "managed-setup",
    "faq",
  ];

  for (const id of expectedSections) {
    assert.match(source, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  const sectionOrder = [
    'className="lp-hero"',
    'id="problem"',
    'id="radar"',
    'id="workflow"',
    'id="campaign-types"',
    'id="approval"',
    'id="reporting"',
    'id="free-trial"',
    'id="managed-setup"',
    'id="faq"',
  ];
  let previousIndex = -1;
  for (const marker of sectionOrder) {
    const index = source.indexOf(marker);
    assert.ok(index > previousIndex, `${marker} should appear after the previous major section`);
    previousIndex = index;
  }

  const ids = [...combined.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "landing and setup form IDs must be unique");

  const localAnchors = [...source.matchAll(/href="#([A-Za-z0-9_-]+)"/g)].map((match) => match[1]);
  for (const target of localAnchors) {
    assert.ok(ids.includes(target), `#${target} anchor must target an existing ID`);
  }

  assert.match(source, /href="#free-trial"/);
  assert.match(source, /href="#managed-setup"/);
});

test("landing page local hero images resolve from public assets", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  const assets = [...source.matchAll(/(?:src|srcSet)="(\/hero\/[^"]+)"/g)].map((match) => match[1]);

  assert.ok(assets.length >= 1, "landing page should use local hero assets");
  for (const asset of assets) {
    assert.ok(existsSync(path.join("public", asset.slice(1))), `${asset} should exist under public/`);
  }
});

test("landing page metadata matches Blockwise positioning", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const home = readFileSync("src/app/page.tsx", "utf8");
  const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");

  assert.match(layout, /Blockwise \| Real Estate Meta Ads Workflow/);
  assert.match(layout, /create, approve, launch, and track Meta ad campaigns through their own ad account/);
  assert.match(layout, /type:\s*"website"/);
  assert.match(layout, /card:\s*"summary_large_image"/);
  assert.doesNotMatch(layout, /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/);
  assert.match(home, /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/);
  assert.match(pricing, /alternates:\s*\{\s*canonical:\s*"\/pricing"\s*\}/);
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

test("robots and 404 keep protected routes out of search and anonymous visitors on public home", () => {
  const robots = readFileSync("src/app/robots.ts", "utf8");
  const notFound = readFileSync("src/app/not-found.tsx", "utf8");

  for (const route of ["/home", "/settings", "/pwa", "/reset-password", "/forgot-password"]) {
    assert.match(robots, new RegExp(`"${route}"`));
  }

  assert.match(notFound, /href="\/"[\s\S]*Back to home/);
  assert.match(notFound, /className="button secondary"[\s\S]*href="\/self-serve"[\s\S]*Go to dashboard/);
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
