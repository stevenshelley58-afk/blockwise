import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
const home = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");

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

test("Ad Studio creation navigation uses a calm creation icon", () => {
  assert.match(shell, /SquarePen/);
  assert.doesNotMatch(shell, /Sparkles/);
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
  assert.match(home, /<span>Start with this template<\/span>/);
  assert.match(home, /<button\s+type="submit"[\s\S]*?aria-label=\{`Start with \$\{template\.name\}`}\s+[\s\S]*?Start with this template/);
  assert.doesNotMatch(home, /href=\{`\/ad-studio\/templates\/\$\{encodeURIComponent\(template\.templateId\)\}`\}/);
  assert.doesNotMatch(home, /listing|property/i);
});

