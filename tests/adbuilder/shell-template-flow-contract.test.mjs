import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("src/components/adbuilder/studio-shell.tsx", "utf8");
const home = readFileSync("src/app/(customer)/ad-builder/page.tsx", "utf8");
const templates = readFileSync("src/app/(customer)/ad-builder/templates/page.tsx", "utf8");
const gallery = readFileSync("src/components/adbuilder/template-gallery.tsx", "utf8");
const adsLibrary = readFileSync("src/components/adbuilder/ads-library.tsx", "utf8");
const mediaLibrary = readFileSync("src/components/adbuilder/media-library.tsx", "utf8");
const homeCommand = readFileSync("src/components/adbuilder/home-command.tsx", "utf8");

test("Ad Builder preserves the desktop symbol and gives mobile an explicit home link", () => {
  assert.match(shell, /href="\/ad-studio"[\s\S]*?aria-label="Blockwise home"[\s\S]*?<BlockwiseLogo tokens \/>/);
  const mobileHeader = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
  assert.match(mobileHeader, /href="\/ad-studio"/);
  assert.match(mobileHeader, /<ArrowLeft size=\{16\} aria-hidden/);
  assert.match(mobileHeader, /<span>Blockwise<\/span>/);
  assert.match(mobileHeader, /min-h-11/);
  assert.match(mobileHeader, /focus-visible:ring-ring/);
  assert.match(mobileHeader, /Ad Builder/);
});

test("Ad Builder keeps its legible desktop mark and mobile exit", () => {
  // The chrome is themed, not hardcoded: the lockup and the mobile exit read on
  // the rail's dark surface through the brand-ink and ink roles.
  assert.match(shell, /text-\(--brand-ink\)/);
  const mobileHeader = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
  assert.match(mobileHeader, /font-semibold text-\(--ink\)/);
  assert.match(shell, /<aside\s+data-theme="studio-dark"/);
  assert.match(shell, /<header\s+data-theme="studio-dark"/);
});

test("the dark scope is the rail and the mobile header, never the document", () => {
  // The canvas, the dialogs, the sheets and every portaled overlay are the light
  // theme. The scope must not come back onto <html>, and the shell root must not
  // carry it, or Ad Builder becomes a second dark app again.
  assert.doesNotMatch(shell, /documentElement/);
  assert.match(shell, /<div\s+className=\{cn\("tw flex bg-background text-foreground"/);
});

test("Ad Builder navigation exposes the simplified Home, Templates, Video, Library, and Brand path", () => {
  assert.match(shell, /label: "Home", icon: Home/);
  assert.match(shell, /label: "Templates", icon: LayoutTemplate/);
  assert.match(shell, /label: "Video", icon: Film/);
  assert.match(shell, /label: "Library", icon: Library/);
  assert.match(shell, /label: "Brand Pack", icon: Palette/);
  assert.doesNotMatch(shell, /Sparkles/);
  assert.match(shell, /const contextual = pathname\.startsWith\("\/ad-builder\/ads\/"\)/);
  assert.doesNotMatch(shell, /contextual[\s\S]{0,120}templates/);
});

test("the rail carries the one create action and it is not a sixth nav row", () => {
  // The rail is already at five siblings. Creation is the filled pill above the
  // list, so it is reachable from every Ad Builder route without adding a row.
  assert.match(shell, /href="\/ad-builder\/templates" aria-label="Create a new ad from a reviewed template"/);
  assert.match(shell, /<Button asChild className="w-full justify-start">/);
  const nav = shell.slice(shell.indexOf("<nav"), shell.indexOf("</nav>"));
  assert.doesNotMatch(nav, /Create|New ad/);
});

test("template search preserves the active lead filter", () => {
  assert.match(templates, /lead !== "all" \? <input type="hidden" name="lead" value=\{lead\} \/> : null/);
  for (const label of ["All leads", "Seller leads", "Buyer leads", "Appraisal leads", "Open home leads", "Market update leads"]) {
    assert.match(templates, new RegExp(label));
  }
});

test("template and saved-ad empty states stay focused at narrow widths", () => {
  assert.match(gallery, /const hasActiveFilter = Boolean\(query\) \|\| lead !== "all"/);
  assert.match(gallery, /if \(!hasAvailableTemplates\)/);
  assert.match(gallery, /No reviewed templates available/);
  assert.match(gallery, /Review Brand Pack/);
  assert.match(gallery, /Return to Ad Builder/);
  assert.doesNotMatch(gallery, /href="\/ad-builder\/library\?view=ads"/);
  assert.match(templates, /templates\.length > 0 \? <form/);
  assert.doesNotMatch(templates, /No templates have been imported yet/);
  assert.match(adsLibrary, /<li className="min-w-0">/);
});

test("searches and filters use one two-row Ad Builder control pattern", () => {
  assert.match(templates, /<SearchField[\s\S]*?<SearchFilterRow>/);
  assert.match(adsLibrary, /<SearchField[\s\S]*?<SearchFilterRow/);
  assert.match(mediaLibrary, /<SearchField[\s\S]*?<SearchFilterRow/);
});

test("Home uses one obvious creation action without a second search", () => {
  assert.match(homeCommand, /aria-label="Create a new ad from a reviewed template"/);
  assert.doesNotMatch(homeCommand, /studio-command|role="search"|Or search templates/);
});

test("Home names the place once and keeps the phone nav complete", () => {
  // The sidebar said "Home" and the page said "Ads". The page now heads the list
  // it actually shows, and the narrow-width row is the full builder nav, so
  // Video is reachable on a phone.
  assert.match(homeCommand, /<h1 id="recent-work-heading"/);
  assert.doesNotMatch(homeCommand, />Ads<\/h1>/);
  const nav = homeCommand.slice(homeCommand.indexOf("<nav"), homeCommand.indexOf("</nav>"));
  assert.match(nav, /md:hidden/);
  for (const href of ["/ad-builder/templates", "/ad-builder/video", "/ad-builder/library?view=assets", "/ad-builder/brand"]) {
    assert.match(nav, new RegExp(href.replace(/[/?]/g, "\\$&")));
  }
});

test("a recent ad has one way in and one secondary action", () => {
  const recent = homeCommand.slice(homeCommand.indexOf("function RecentAd"));
  assert.match(recent, /<Link href=\{editorHref\}/);
  assert.doesNotMatch(recent, />Edit</);
  assert.match(recent, /<Link href=\{reviewHref\}>Review<\/Link>/);
  // Review must not be desktop-only: the publish path has to exist on a phone.
  assert.doesNotMatch(recent, /hidden sm:inline-flex/);
});

test("hub routes creation to templates while selected cards create directly", () => {
  assert.match(homeCommand, /href="\/ad-builder\/templates"/);
  assert.match(homeCommand, />New ad<\//);
  assert.doesNotMatch(home, /createAdAction|createCustomerAd|"use server"/);

  assert.match(templates, /async function createAdAction\(formData: FormData\)/);
  assert.match(templates, /"use server"/);
  assert.match(templates, /requirePageSurfaceAccess\("adbuilder"\)/);
  assert.match(templates, /const creationKey = String\(formData\.get\("creationKey"\) \?\? ""\)\.trim\(\)/);
  assert.match(templates, /const templateId = String\(formData\.get\("templateId"\) \?\? ""\)\.trim\(\)/);
  assert.match(templates, /Invalid creation request/);
  assert.match(templates, /const pack = await getTemplate\(supabase, templateId\)/);
  assert.match(templates, /createCustomerAd\(supabase, access\.workspaceId, pack, creationKey\)/);
  assert.match(templates, /redirect\(/);
  assert.match(templates, /createAction=\{createAdAction\}/);
  assert.match(gallery, /name="creationKey" value=\{crypto\.randomUUID\(\)\}/);
  assert.match(gallery, /name="templateId" value=\{template\.templateId\}/);
  assert.match(gallery, /Use template/);
  assert.match(gallery, /Preview template/);
  const templateCard = gallery.slice(gallery.indexOf("function TemplateCard"));
  assert.doesNotMatch(templateCard, /Preview Feed \+ Story|Reviewed|image inputs|text inputs|template\.description/);
  assert.match(gallery, /href=\{`\/ad-builder\/templates/);
  assert.doesNotMatch(home, /listing|property/i);
});
