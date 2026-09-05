import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
const home = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
const templates = readFileSync("src/app/(customer)/ad-studio/templates/page.tsx", "utf8");
const gallery = readFileSync("src/components/adstudio/template-gallery.tsx", "utf8");
const adsLibrary = readFileSync("src/components/adstudio/ads-library.tsx", "utf8");
const mediaLibrary = readFileSync("src/components/adstudio/media-library.tsx", "utf8");
const homeCommand = readFileSync("src/components/adstudio/home-command.tsx", "utf8");

test("Ad Studio preserves the desktop symbol and gives mobile an explicit home link", () => {
  assert.match(shell, /href="\/self-serve"[\s\S]*?aria-label="Back to Blockwise"[\s\S]*?<BlockwiseLogo tokens showWordmark=\{false\}/);
  const mobileHeader = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
  assert.match(mobileHeader, /href="\/self-serve"/);
  assert.match(mobileHeader, /<ArrowLeft size=\{16\} aria-hidden/);
  assert.match(mobileHeader, /<span>Blockwise<\/span>/);
  assert.match(mobileHeader, /min-h-11/);
  assert.match(mobileHeader, /focus-visible:ring-white/);
  assert.match(mobileHeader, /Ad Studio/);
});

test("Ad Studio keeps its white desktop mark and legible mobile exit", () => {
  assert.match(shell, /size-9[^\n]*bg-transparent text-white/);
  const mobileHeader = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
  assert.match(mobileHeader, /font-semibold text-white/);
  assert.doesNotMatch(shell, /bg-\(--surface\) text-\(--ink\)/);
});

test("Ad Studio navigation exposes the simplified Home, Templates, Library, and Brand path", () => {
  assert.match(shell, /label: "Home", icon: Home/);
  assert.match(shell, /label: "Templates", icon: LayoutTemplate/);
  assert.match(shell, /label: "Library", icon: Library/);
  assert.match(shell, /label: "Brand Pack", icon: Palette/);
  assert.doesNotMatch(shell, /Sparkles/);
  assert.match(shell, /const contextual = pathname\.startsWith\("\/ad-studio\/ads\/"\)/);
  assert.doesNotMatch(shell, /contextual[\s\S]{0,120}templates/);
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
  assert.match(gallery, /Templates are in final review/);
  assert.match(gallery, /Your saved ads remain available/);
  assert.match(gallery, /href="\/ad-studio\/library\?view=ads"/);
  assert.match(templates, /templates\.length > 0 \? <form/);
  assert.doesNotMatch(templates, /No templates have been imported yet/);
  assert.match(adsLibrary, /<li className="min-w-0">/);
});

test("searches and filters use one two-row Ad Studio control pattern", () => {
  assert.match(templates, /<SearchField[\s\S]*?<SearchFilterRow>/);
  assert.match(adsLibrary, /<SearchField[\s\S]*?<SearchFilterRow/);
  assert.match(mediaLibrary, /<SearchField[\s\S]*?<SearchFilterRow/);
});

test("Home uses one obvious creation action without a second search", () => {
  assert.match(homeCommand, /aria-label="Create a new ad from a reviewed template"/);
  assert.doesNotMatch(homeCommand, /studio-command|role="search"|Or search templates/);
});

test("template cards create the selected customer ad directly", () => {
  assert.match(home, /async function createAdAction\(creationKey: string, formData: FormData\)/);
  assert.match(home, /"use server"/);
  assert.match(home, /requirePageSurfaceAccess\("adstudio"\)/);
  assert.match(home, /const templateId = String\(formData\.get\("templateId"\) \?\? ""\)\.trim\(\)/);
  assert.match(home, /const pack = await getTemplate\(supabase, templateId\)/);
  assert.match(home, /createCustomerAd\(supabase, access\.workspaceId, pack, creationKey\)/);
  assert.match(home, /redirect\(`\/ad-studio\/ads\/\$\{encodeURIComponent\(ad\.adId\)\}`\)/);
  assert.match(home, /action=\{createAdAction\.bind\(null, crypto\.randomUUID\(\)\)\}/);
  assert.match(home, /<input type="hidden" name="templateId" value=\{template\.templateId\} \/>/);
  assert.match(templates, /async function createAdAction\(formData: FormData\)/);
  assert.match(templates, /const creationKey = String\(formData\.get\("creationKey"\)/);
  assert.match(gallery, /name="creationKey" value=\{crypto\.randomUUID\(\)\}/);
  assert.match(gallery, /name="templateId" value=\{template\.templateId\}/);
  assert.match(gallery, /Use template/);
  assert.match(gallery, /Preview template/);
  const templateCard = gallery.slice(gallery.indexOf("function TemplateCard"));
  assert.doesNotMatch(templateCard, /Preview Feed \+ Story|Reviewed|image inputs|text inputs|template\.description/);
  assert.match(gallery, /href=\{`\/ad-studio\/templates\/\$\{encodeURIComponent\(template\.templateId\)\}`\}/);
  assert.doesNotMatch(home, /listing|property/i);
});

