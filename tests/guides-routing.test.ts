import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");
const guidesPage = readFileSync("src/app/guides/page.tsx", "utf8");
const guidesStyles = readFileSync("src/app/guides/guides.css", "utf8");
const guideArticle = readFileSync("src/app/guides/sold-price-list-seller-leads/page.tsx", "utf8");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");

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

test("featured guide media stays inside its grid track", () => {
  const featureImageRule = guidesStyles.match(/\.bw-guides-feature-image\s*\{(?<body>[^}]*)\}/u)?.groups?.body ?? "";

  assert.match(featureImageRule, /height:\s*100%/u);
  assert.match(featureImageRule, /min-height:\s*0/u);
  assert.match(featureImageRule, /min-width:\s*0/u);
  assert.match(featureImageRule, /width:\s*100%/u);
  assert.doesNotMatch(featureImageRule, /aspect-ratio|min-height:\s*100%/u);
  assert.match(guidesStyles, /\.bw-guides-feature-image\s*\{\s*aspect-ratio:\s*16\s*\/\s*10;\s*height:\s*auto;\s*\}/u);
});
