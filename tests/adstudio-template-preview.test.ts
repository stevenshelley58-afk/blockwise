import assert from "node:assert/strict";
import test from "node:test";

import { AD_STUDIO_TEMPLATES, extractBrandKitFromWebsite } from "../src/lib/adstudio/index.ts";
import { templatePreviewSvg } from "../src/lib/adstudio/template-preview.ts";

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
  // Sample copy for the layout is present...
  assert.match(svg, /strong local result/iu);
  // ...and it uses the customer's brand primary colour for the CTA.
  assert.match(svg, new RegExp(kit.colours.primary.replace(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&"), "u"));
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
