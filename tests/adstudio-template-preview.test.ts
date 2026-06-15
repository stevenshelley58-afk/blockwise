import assert from "node:assert/strict";
import test from "node:test";

import { AD_STUDIO_TEMPLATES, extractBrandKitFromWebsite } from "../src/lib/adstudio/index.ts";
import { templatePreviewDataUrl, templatePreviewSvg } from "../src/lib/adstudio/template-preview.ts";

const html = `
  <html><head><title>Realty Plus</title>
  <style>body{font-family:Inter,sans-serif}.btn{background:#123E75}</style></head>
  <body><img src="/logo.svg" alt="Realty Plus logo"><p>Local agents.</p></body></html>
`;

function brandKit() {
  return extractBrandKitFromWebsite({
    workspaceId: "workspace_real",
    websiteUrl: "https://realtyplus.example.com",
    marketCountry: "AU",
    htmlByUrl: { "https://realtyplus.example.com": html },
  });
}

test("templatePreviewSvg renders a branded layout preview (no AI/baked photo)", () => {
  const kit = brandKit();
  const svg = templatePreviewSvg(AD_STUDIO_TEMPLATES.find((t) => t.id === "just_sold")!, kit);
  assert.match(svg, /^<svg[\s>]/u);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/u);
  // Sample copy for the layout is present (headline may wrap across lines)...
  assert.match(svg, /strong local/iu);
  // ...the customer's brand and a "your photo" placeholder are shown...
  assert.match(svg, /Your listing photo/u);
  assert.match(svg, /Realty/u);
  // ...and it uses the customer's brand primary colour.
  assert.match(svg, new RegExp(kit.colours.primary.replace(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&"), "iu"));
});

test("every template (built-in + a radar-shaped one) produces a preview", () => {
  const kit = brandKit();
  for (const template of AD_STUDIO_TEMPLATES) {
    assert.ok(templatePreviewSvg(template, kit).startsWith("<svg"), `${template.id} preview failed`);
  }
  // A radar template (non-built-in id) still renders via goal-driven archetype selection.
  const radar = { id: "market_update_report_data", name: "Market Update / Report", goal: "market_update_leads", offerId: "suburb_market_report", promptHint: "x" } as const;
  assert.ok(templatePreviewSvg(radar, kit).startsWith("<svg"));
});

test("template preview data URL does not throw on malformed mined template text", () => {
  const kit = brandKit();
  const template = {
    id: "bad_unicode_template",
    name: "Broken \uD800 template",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "A scraped ad left a lone surrogate here \uD800 and should not crash.",
  } as const;

  assert.doesNotThrow(() => templatePreviewDataUrl(template, kit));
  assert.match(templatePreviewDataUrl(template, kit), /^data:image\/svg\+xml;utf8,/);
});

test("template preview data URL falls back instead of crashing on incomplete runtime rows", () => {
  const kit = {
    colours: {},
    typography: {},
    identity: {},
  } as unknown as ReturnType<typeof brandKit>;
  const template = {
    id: "incomplete_runtime_template",
    name: "Incomplete runtime template",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Should still render",
    creativeSkeleton: {
      composition: {},
    },
  } as unknown as (typeof AD_STUDIO_TEMPLATES)[number];

  assert.doesNotThrow(() => templatePreviewDataUrl(template, kit));
  assert.match(templatePreviewDataUrl(template, kit), /^data:image\/svg\+xml;utf8,/);
});
