import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  builtInAdStudioTemplates,
  renderDesign,
  resolvableAdStudioTemplates,
  resolveAdStudioTemplate,
  resolveTemplateDesignForFormat,
  templateDesignSchema,
} from "../src/lib/adstudio/index.ts";
import { EXTRACTED_META_SAMPLE_CARD_VERSION } from "../src/lib/adstudio/extracted-meta-template-builder.ts";
import { EXTRACTED_META_TEMPLATE_DESCRIPTORS, EXTRACTED_META_TEMPLATE_SLICE_SIZE, EXTRACTED_META_TEMPLATE_TOTAL } from "../src/lib/adstudio/extracted-meta-templates.generated.ts";
import { GOLD_AD_STUDIO_TEMPLATES, GOLD_SAMPLE_CARD_VERSION, GOLD_TEMPLATE_RENDER_SAMPLES } from "../src/lib/adstudio/gold-adstudio-templates.ts";
import { templatePreviewDataUrl } from "../src/lib/adstudio/template-preview.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";
import { imageDimensionsFromBytes } from "../src/lib/adstudio/image-dimensions.ts";
import type { AdStudioFormat } from "../src/lib/adstudio/types.ts";

const FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly AdStudioFormat[];

function brandKit() {
  return buildTrialFallbackBrandKit({
    workspaceId: "workspace_extracted_meta",
    workspaceName: "Blockwise Realty",
    region: "WA",
  });
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height?: number },
  b: { x: number; y: number; width: number; height?: number },
) {
  const ah = a.height ?? 0;
  const bh = b.height ?? 0;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + bh && a.y + ah > b.y;
}

test("template gallery exposes only quality-gated gold templates", () => {
  const visible = builtInAdStudioTemplates();
  const goldIds = GOLD_AD_STUDIO_TEMPLATES.map((template) => template.id);
  const expectedIds = new Set<string>(EXTRACTED_META_TEMPLATE_DESCRIPTORS.map((descriptor) => descriptor.id));

  assert.equal(EXTRACTED_META_TEMPLATE_TOTAL, 330);
  assert.equal(EXTRACTED_META_TEMPLATE_SLICE_SIZE, 10);
  assert.equal(EXTRACTED_META_TEMPLATE_DESCRIPTORS.length, 10);
  assert.deepEqual(visible.map((template) => template.id), goldIds);
  assert.equal(new Set(visible.map((template) => template.id)).size, GOLD_AD_STUDIO_TEMPLATES.length);
  assert.ok(visible.every((template) => template.source === "operator"));
  assert.ok(visible.every((template) => template.status === "approved"));
  assert.ok(visible.every((template) => !template.manualFirstPass));
  assert.ok(!visible.some((template) => template.id === "free_appraisal"));
  assert.ok(!visible.some((template) => expectedIds.has(template.id)), "extracted first-pass templates stay hidden");
});

test("hidden extracted Meta slice remains resolvable for existing drafts", () => {
  const resolvable = resolvableAdStudioTemplates();
  const resolvableById = new Map(resolvable.map((template) => [template.id, template]));

  for (const descriptor of EXTRACTED_META_TEMPLATE_DESCRIPTORS) {
    const template = resolvableById.get(descriptor.id);
    assert.ok(template, `${descriptor.id} should remain resolvable`);
    assert.equal(template.source, "radar");
    assert.equal(template.status, "approved");
    assert.equal(resolveAdStudioTemplate(descriptor.id).id, descriptor.id);
  }
});

test("old first-pass template keys are deleted from the current template set", () => {
  const fallback = resolveAdStudioTemplate("free_appraisal");
  assert.notEqual(fallback.id, "free_appraisal");
  assert.equal(fallback.id, GOLD_AD_STUDIO_TEMPLATES[0].id);
  assert.ok(!builtInAdStudioTemplates().some((template) => template.id === "free_appraisal"));
});

test("gold templates have strict renderable TemplateDesign variants and real gallery cards", () => {
  const kit = brandKit();
  const visibleById = new Map(builtInAdStudioTemplates().map((template) => [template.id, template]));

  for (const gold of GOLD_AD_STUDIO_TEMPLATES) {
    const template = visibleById.get(gold.id);
    assert.ok(template, `${gold.id} should be visible`);
    assert.equal(template.templateKey, gold.id);
    assert.equal(template.source, "operator");
    assert.equal(template.sampleCardImageUrl, `/adstudio-samples/gold/${gold.id}.png?v=${GOLD_SAMPLE_CARD_VERSION}`);
    assert.equal(template.sampleStyle?.sampleCardImagePath, `adstudio-samples/gold/${gold.id}.png`);
    assert.equal(templatePreviewDataUrl(template, kit), `/adstudio-samples/gold/${gold.id}.png?v=${GOLD_SAMPLE_CARD_VERSION}`);

    for (const format of FORMATS) {
      const design = resolveTemplateDesignForFormat(template, format);
      assert.ok(design, `${gold.id} should have ${format} design`);
      assert.equal(design.templateId, gold.id);
      assert.deepEqual(templateDesignSchema.parse(design), design);
      assert.ok(design.layers.some((layer) => layer.type === "image_slot" && layer.id === "primary_photo"));
      assert.ok(design.layers.some((layer) => layer.type === "text" && layer.slot === "headline" && layer.fill === "ai_copy"));
      assert.ok(design.layers.some((layer) => layer.type === "cta_button" && layer.label === "cta"));

      const creative = renderDesign(design, {
        text: {
          eyebrow: template.name,
          headline: template.sampleCopy?.headline ?? template.name,
          body: template.sampleCopy?.primaryText ?? template.promptHint,
          cta: template.sampleCopy?.cta ?? "Learn more",
          address: template.sampleStyle?.address ?? "",
          stat: "2 bed / 2 bath",
        },
        images: {
          primary_photo: "data:image/png;base64,AAAA",
        },
      }, kit);
      assert.match(creative.previewSvg, /^<svg[\s>]/u);
      assert.ok(creative.canvas.objects.some((object) => object.sourceLayerId === "primary_photo"));
      assert.ok(creative.canvas.objects.some((object) => object.role === "cta_button"));
      assert.ok(creative.canvas.objects
        .filter((object) => object.type === "text")
        .every((object) => (object.size ?? 0) >= 18), `${gold.id} ${format} should not render tiny text`);
      assert.ok(creative.canvas.objects
        .filter((object) => object.role === "headline")
        .every((object) => (object.size ?? 0) >= 46), `${gold.id} ${format} should have a professional headline scale`);
      const ctaShape = creative.canvas.objects.find((object) => object.role === "cta_button");
      assert.ok(ctaShape);
      for (const text of creative.canvas.objects.filter((object) => object.type === "text" && object.objectId !== "cta_label")) {
        assert.equal(rectsOverlap(ctaShape, text), false, `${gold.id} ${format} CTA overlaps ${text.objectId}`);
      }
    }
  }
});

test("gold templates are standalone mini-project modules, not one shared layout engine", () => {
  const indexSource = readFileSync("src/lib/adstudio/gold-adstudio-templates.ts", "utf8");
  assert.doesNotMatch(indexSource, /\bSPECS\b/);
  assert.doesNotMatch(indexSource, /switch\s*\(/);
  assert.doesNotMatch(indexSource, /\blayout\s*:/);

  const moduleFiles = readdirSync("src/lib/adstudio/gold-templates")
    .filter((file) => file.endsWith(".ts") && file !== "primitives.ts");
  assert.equal(moduleFiles.length, GOLD_AD_STUDIO_TEMPLATES.length);
  assert.equal(Object.keys(GOLD_TEMPLATE_RENDER_SAMPLES).length, GOLD_AD_STUDIO_TEMPLATES.length);

  for (const template of GOLD_AD_STUDIO_TEMPLATES) {
    assert.ok(GOLD_TEMPLATE_RENDER_SAMPLES[template.id], `${template.id} should own its sample render data`);
  }
});

test("each extracted template has strict renderable TemplateDesign variants", () => {
  const kit = brandKit();
  const visibleIds = new Set(builtInAdStudioTemplates().map((template) => template.id));
  const resolvableById = new Map(resolvableAdStudioTemplates().map((template) => [template.id, template]));

  for (const descriptor of EXTRACTED_META_TEMPLATE_DESCRIPTORS) {
    assert.equal(visibleIds.has(descriptor.id), false, `${descriptor.id} should be hidden from the gallery`);
    const template = resolvableById.get(descriptor.id);
    assert.ok(template, `${descriptor.id} should be resolvable`);
    assert.equal(template.templateKey, descriptor.id);
    assert.equal(template.name, descriptor.name);
    assert.equal(template.sampleCopy?.headline, descriptor.sampleCopy.headline);
    assert.equal(template.sampleStyle?.sampleSuburb, descriptor.sampleStyle.sampleSuburb);

    for (const format of FORMATS) {
      const design = resolveTemplateDesignForFormat(template, format);
      assert.ok(design, `${descriptor.id} should have ${format} design`);
      assert.equal(design.templateId, descriptor.id);
      assert.deepEqual(templateDesignSchema.parse(design), design);
      assert.ok(design.layers.some((layer) => layer.type === "image_slot" && layer.id === "primary_photo"));
      assert.ok(design.layers.some((layer) => layer.type === "text" && layer.slot === "headline" && layer.fill === "ai_copy"));
      assert.ok(design.layers.some((layer) => layer.type === "cta_button" && layer.label === "cta"));

      const creative = renderDesign(design, {
        text: {
          eyebrow: template.name,
          headline: template.sampleCopy?.headline ?? template.name,
          body: template.sampleCopy?.primaryText ?? template.promptHint,
          cta: template.sampleCopy?.cta ?? "Learn more",
          address: template.sampleStyle?.address ?? "",
        },
        images: {
          primary_photo: "data:image/png;base64,AAAA",
        },
      }, kit);
      assert.match(creative.previewSvg, /^<svg[\s>]/u);
      assert.ok(creative.canvas.objects.some((object) => object.sourceLayerId === "primary_photo"));
    }

    assert.equal(resolveTemplateDesignForFormat(template, "1.91:1"), null, `${descriptor.id} should not expose landscape`);
    assert.equal(template.sampleCardImageUrl, `/adstudio-samples/extracted-meta/${descriptor.id}.png?v=${EXTRACTED_META_SAMPLE_CARD_VERSION}`);
    assert.equal(template.sampleStyle?.sampleCardImagePath, `adstudio-samples/extracted-meta/${descriptor.id}.png`);
    assert.equal(templatePreviewDataUrl(template, kit), `/adstudio-samples/extracted-meta/${descriptor.id}.png?v=${EXTRACTED_META_SAMPLE_CARD_VERSION}`);
  }
});

test("extracted Meta gallery sample cards are rendered from TemplateDesign outputs", () => {
  const renderer = readFileSync("scripts/adstudio-render-extracted-meta-sample-cards.mjs", "utf8");
  assert.match(renderer, /renderDesign\(/);
  assert.match(renderer, /resolveTemplateDesignForFormat\(template, FORMAT\)/);
  assert.match(renderer, /sharp\(Buffer\.from\(creative\.previewSvg\)\)/);
  assert.doesNotMatch(renderer, /meta_ad_candidates|sourceFile|SOURCE_ROOT/);

  for (const descriptor of EXTRACTED_META_TEMPLATE_DESCRIPTORS) {
    const bytes = readFileSync(`public/adstudio-samples/extracted-meta/${descriptor.id}.png`);
    assert.deepEqual(
      imageDimensionsFromBytes(bytes),
      { width: 1080, height: 1350 },
      `${descriptor.id} sample card should be a Feed 4:5 TemplateDesign render`,
    );
  }
});

test("extracted Meta gallery renderer verifies committed TemplateDesign sample assets", () => {
  execFileSync(
    "node",
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "scripts/adstudio-render-extracted-meta-sample-cards.mjs",
      "--verify-only",
    ],
    { stdio: "pipe" },
  );
});

test("gold gallery renderer verifies committed TemplateDesign sample assets", () => {
  execFileSync(
    "node",
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "scripts/adstudio-render-gold-template-sample-cards.mjs",
      "--verify-only",
    ],
    { stdio: "pipe" },
  );

  for (const template of GOLD_AD_STUDIO_TEMPLATES) {
    const bytes = readFileSync(`public/adstudio-samples/gold/${template.id}.png`);
    assert.deepEqual(
      imageDimensionsFromBytes(bytes),
      { width: 1080, height: 1350 },
      `${template.id} sample card should be a Feed 4:5 TemplateDesign render`,
    );
  }
});
