import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");
const guidesPage = readFileSync("src/app/guides/page.tsx", "utf8");
const guidesStyles = readFileSync("src/app/guides/guides.css", "utf8");
const guideArticle = readFileSync("src/app/guides/sold-price-list-seller-leads/page.tsx", "utf8");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const copyBlock = readFileSync("src/components/guides/guide-copy-block.tsx", "utf8");

test("guides are the canonical public content routes", () => {
  assert.equal(existsSync("src/app/blog"), false);
  assert.match(guidesPage, /alternates:\s*\{\s*canonical:\s*"\/guides"\s*\}/u);
  assert.match(guideArticle, /const canonical = "\/guides\/sold-price-list-seller-leads"/u);
  assert.match(sitemap, /\$\{SITE_URL\}\/guides/u);
  assert.match(sitemap, /\$\{SITE_URL\}\/guides\/sold-price-list-seller-leads/u);
});

test("legacy public content links redirect permanently to guides", () => {
  assert.match(nextConfig, /source:\s*"\/blog",\s*destination:\s*"\/guides",\s*permanent:\s*true/u);
  assert.match(nextConfig, /source:\s*"\/blog\/:path\*",\s*destination:\s*"\/guides\/:path\*",\s*permanent:\s*true/u);
});

test("guides hub is text-first, grouped, and actionable", () => {
  assert.doesNotMatch(guidesPage, /next\/image/u);
  assert.match(guidesPage, /Practical notes for real-estate advertising\./u);
  assert.match(guidesPage, /sample sold-price resource/u);
  assert.match(guidesPage, /delivery email/u);
  assert.match(guidesPage, /review plan/u);
  assert.match(guidesPage, /Browse by topic/u);
  assert.match(guidesPage, /Featured guide/u);
  assert.match(guidesPage, /Choose the offer/u);
  assert.match(guidesPage, /Build the campaign/u);
  assert.match(guidesPage, /Improve what happens next/u);
  assert.match(guidesPage, /\/guides\/sold-price-list-seller-leads/u);
  const guideHrefs = [...guidesPage.matchAll(/href:\s*"((?:\/guides\/)[^"]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(guideHrefs).size, 8);
  assert.equal((guidesPage.match(/Browse by topic/gu) ?? []).length, 1);
  assert.match(guidesStyles, /\.bw-guide-list\s*\{/u);
  assert.match(guidesStyles, /\.bw-guides-index \{[\s\S]*margin:\s*0 auto/u);
  assert.match(guidesStyles, /\.bw-guides-feature \{[\s\S]*color:\s*var\(--white\)/u);
  assert.match(guidesStyles, /\.bw-guides-feature-details \{[\s\S]*display:\s*grid/u);
  assert.match(guidesStyles, /\.bw-guides-read-link \{[\s\S]*display:\s*flex/u);
  assert.match(guidesStyles, /\.bw-article-toc\s*\{[\s\S]*display:\s*grid/u);
  assert.doesNotMatch(guidesStyles, /bw-guides-principles|bw-guides-method|bw-guide-card-image|bw-hero-pin/u);
  assert.match(guidesStyles, /\.bw-article-hero:not\(:has\(\.bw-article-hero-media\)\)/u);
  assert.match(guidesStyles, /\.bw-measure-table > div:has\(> :nth-child\(5\)\)/u);
  assert.match(guidesStyles, /\.bw-calculator-fields\s*\{/u);
  assert.doesNotMatch(guidesStyles, /\.bw-measure-head \{ display: none/u);
});


test("guide copy block provides a real accessible copy action and fallback", () => {
  assert.match(copyBlock, /"use client"/u);
  assert.match(copyBlock, /navigator\.clipboard\?\.writeText/u);
  assert.match(copyBlock, /role="status"/u);
  assert.match(copyBlock, /Select the text above to copy it manually/u);
  assert.match(guidesStyles, /\.bw-copy-block-text[\s\S]*user-select:\s*text/u);
  assert.match(guidesStyles, /\.bw-copy-block-text[\s\S]*white-space:\s*pre-wrap/u);
  assert.match(guidesStyles, /\.bw-copy-block-text[\s\S]*overflow-wrap:\s*anywhere/u);
});
