import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractBrandKitFromWebsite } from "../src/lib/adstudio/brand-extraction.ts";

const websiteUrl = "https://www.raywhite.com";

function extract(html: string, stylesheetTextByUrl: Record<string, string> = {}) {
  return extractBrandKitFromWebsite({
    workspaceId: "workspace-ray-white",
    websiteUrl,
    marketCountry: "AU",
    htmlByUrl: { [websiteUrl]: html },
    stylesheetTextByUrl,
  });
}

test("extracts metadata regardless of attribute order and decodes numeric entities", () => {
  const kit = extract(`
    <html>
      <head>
        <title>Australasia&#039;s largest real estate group • Ray White</title>
        <meta content="Ray White" property="og:site_name">
      </head>
    </html>
  `);

  assert.equal(kit.identity.businessName, "Ray White");
  assert.equal(kit.identity.tradingName, "Ray White");
});

test("uses same-origin stylesheet content for named brand colours and typography", () => {
  const kit = extract(
    `<html><head><link rel="stylesheet" href="/dist/site.css"></head></html>`,
    {
      "https://www.raywhite.com/dist/site.css": `
        [data-theme=default] {
          --primary: #ffe512;
          --secondary: #595959;
          --background: #ffffff;
          --text: #1d1d1b;
        }
        body { font-family: lato, sans-serif; }
        h1, h2, h3 { font-family: playfair-display, serif; }
      `,
    },
  );

  assert.equal(kit.colours.primary, "#FFE512");
  assert.equal(kit.colours.secondary, "#595959");
  assert.equal(kit.colours.background, "#FFFFFF");
  assert.equal(kit.colours.text, "#1D1D1B");
  assert.equal(kit.typography.bodyFont, "lato");
  assert.equal(kit.typography.headingFont, "playfair-display");
  assert.equal(kit.typography.fallbackHeading, "serif");
});

test("does not turn nested page sections into giant copy or disclaimer fields", () => {
  const repeatedNavigation = "Buy Sell Rent Commercial International " .repeat(30);
  const kit = extract(`
    <html><body>
      <h1>Find your local Ray White office</h1>
      <p>${repeatedNavigation}</p>
      <footer><p>Privacy policy ${repeatedNavigation}</p></footer>
    </body></html>
  `);

  assert.ok(kit.tone.sampleCopy.every((copy) => copy.length <= 240));
  assert.ok(kit.compliance.disclaimers.every((disclaimer) => disclaimer.length <= 320));
  assert.ok(!kit.compliance.disclaimers.some((disclaimer) => disclaimer.includes("International Buy Sell Rent")));
});

test("Brand Studio replaces stale previews and never invents logo variants", () => {
  const source = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");

  assert.match(source, /setLogoFile\(null\);[\s\S]*setLogoPreviewUrl\(json\.brandKit\.logos\.primaryLogoUrl \?\? ""\)/);
  assert.doesNotMatch(source, /\{initial\}★/);
  assert.match(source, /kit\.logos\.lightLogoUrl/);
  assert.match(source, /kit\.logos\.faviconUrl/);
});

test("website extraction fetches stylesheet content before building the brand kit", () => {
  const source = readFileSync("src/app/api/adstudio/brand-kits/extract/route.ts", "utf8");

  assert.match(source, /fetchWebsiteStylesheets\(normalizedUrl, html\)/);
  assert.match(source, /stylesheetTextByUrl/);
  assert.match(source, /new URL\(stylesheetUrl\)\.origin !== new URL\(websiteUrl\)\.origin/);
});
