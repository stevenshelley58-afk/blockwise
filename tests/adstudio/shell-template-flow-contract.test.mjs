import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
const home = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
const templates = readFileSync("src/app/(customer)/ad-studio/templates/page.tsx", "utf8");
const gallery = readFileSync("src/components/adstudio/template-gallery.tsx", "utf8");
const adsLibrary = readFileSync("src/components/adstudio/ads-library.tsx", "utf8");

test("Ad Studio shell uses the Blockwise symbol as the customer-home link", () => {
  assert.match(shell, /import \{ BlockwiseLogo \} from "@\/components\/blockwise-logo"/);
  assert.match(shell, /href="\/self-serve"[\s\S]*?aria-label="Back to Blockwise"[\s\S]*?<BlockwiseLogo tokens showWordmark=\{false\}/);
  assert.equal((shell.match(/aria-label="Back to Blockwise"/g) ?? []).length, 2);
  assert.match(shell, /<p className="font-display text-\[15\.5px\] font-extrabold leading-tight">\s*Ad Studio/);
  assert.match(shell, /<span className="min-w-0 truncate font-display text-\[15\.5px\] font-extrabold">\s*Ad Studio/);
  assert.doesNotMatch(shell, /\bA\s*<\//);
});

test("Ad Studio keeps the Blockwise mark white without a logo background wrapper", () => {
  assert.match(shell, /size-9[^\n]*bg-transparent text-white/);
  assert.match(shell, /size-8[^\n]*bg-transparent text-white/);
  assert.equal((shell.match(/bg-transparent/g) ?? []).length, 2);
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

test("template search preserves the active guided filter", () => {
  assert.match(templates, /filter !== "all" \? <input type="hidden" name="filter" value=\{filter\} \/> : null/);
});

test("template and saved-ad empty states stay focused at narrow widths", () => {
  assert.match(gallery, /const hasActiveFilter = Boolean\(query\) \|\| filter !== "all"/);
  assert.match(gallery, /New templates are being prepared/);
  assert.match(gallery, /Reviewed Feed and Story packs will appear here/);
  assert.doesNotMatch(templates, /No templates have been imported yet/);
  assert.match(adsLibrary, /<li className="min-w-0">/);
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
  assert.match(gallery, /href=\{`\/ad-studio\/templates\/\$\{encodeURIComponent\(template\.templateId\)\}`\}/);
  assert.doesNotMatch(home, /listing|property/i);
});

