import assert from "node:assert/strict";
import test from "node:test";

import { AD_STUDIO_TEMPLATES, extractBrandKitFromWebsite, resolvableAdStudioTemplates } from "../src/lib/adstudio/index.ts";
import { GOLD_SAMPLE_CARD_VERSION } from "../src/lib/adstudio/gold-adstudio-templates.ts";
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

test("templatePreviewSvg renders a promoted Meta template preview", () => {
  const kit = brandKit();
  const template = resolvableAdStudioTemplates().find((t) => t.id === "meta_040");
  assert.ok(template);
  const svg = templatePreviewSvg(template, kit);
  assert.match(svg, /^<svg[\s>]/u);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/u);
  assert.match(svg, /Bassendean rental check/iu);
  assert.match(svg, /Get check/iu);
});

test("templatePreviewDataUrl prefers promoted Meta gold sample cards in the gallery", () => {
  const kit = brandKit();
  const template = resolvableAdStudioTemplates().find((t) => t.id === "meta_040");
  assert.ok(template);
  assert.equal(templatePreviewDataUrl(template, kit), `/adstudio-samples/gold/meta_040.png?v=${GOLD_SAMPLE_CARD_VERSION}`);
});

test("every built-in template produces a preview from its own TemplateDesign", () => {
  const kit = brandKit();
  for (const template of AD_STUDIO_TEMPLATES) {
    assert.ok(templatePreviewSvg(template, kit).startsWith("<svg"), `${template.id} preview failed`);
  }
});

test("template preview data URL does not throw on malformed text when a template owns a design", () => {
  const kit = brandKit();
  const base = AD_STUDIO_TEMPLATES[0];
  assert.ok(base);
  const template = {
    ...base,
    id: "bad_unicode_template",
    name: "Broken \uD800 template",
    promptHint: "A scraped ad left a lone surrogate here \uD800 and should not crash.",
    sampleCardImageUrl: undefined,
  };

  assert.doesNotThrow(() => templatePreviewDataUrl(template, kit));
  assert.match(templatePreviewDataUrl(template, kit), /^data:image\/svg\+xml;utf8,/);
});

test("template preview fails loudly on incomplete runtime rows", () => {
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

  assert.throws(() => templatePreviewDataUrl(template, kit), /missing an explicit 4:5 TemplateDesign preview/);
});
