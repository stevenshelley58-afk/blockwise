import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  builtInAdStudioTemplates,
  renderDesign,
  resolveAdStudioTemplate,
  resolveTemplateDesignForFormat,
  templateDesignSchema,
} from "../src/lib/adstudio/index.ts";
import { EXTRACTED_META_SAMPLE_CARD_VERSION } from "../src/lib/adstudio/extracted-meta-template-builder.ts";
import { EXTRACTED_META_TEMPLATE_DESCRIPTORS, EXTRACTED_META_TEMPLATE_SLICE_SIZE, EXTRACTED_META_TEMPLATE_TOTAL } from "../src/lib/adstudio/extracted-meta-templates.generated.ts";
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

test("extracted Meta slice exposes ten individual visible templates", () => {
  const visible = builtInAdStudioTemplates();
  const expectedIds = EXTRACTED_META_TEMPLATE_DESCRIPTORS.map((descriptor) => descriptor.id);

  assert.equal(EXTRACTED_META_TEMPLATE_TOTAL, 330);
  assert.equal(EXTRACTED_META_TEMPLATE_SLICE_SIZE, 10);
  assert.equal(EXTRACTED_META_TEMPLATE_DESCRIPTORS.length, 10);
  assert.deepEqual(visible.map((template) => template.id), expectedIds);
  assert.equal(new Set(visible.map((template) => template.id)).size, 10);
  assert.ok(visible.every((template) => template.source === "radar"));
  assert.ok(visible.every((template) => template.status === "approved"));
  assert.ok(visible.every((template) => !template.manualFirstPass));
  assert.ok(!visible.some((template) => template.id === "free_appraisal"));
});

test("old first-pass template keys are deleted from the current template set", () => {
  const fallback = resolveAdStudioTemplate("free_appraisal");
  assert.notEqual(fallback.id, "free_appraisal");
  assert.equal(fallback.id, "meta_002");
  assert.ok(!builtInAdStudioTemplates().some((template) => template.id === "free_appraisal"));
});

test("each extracted template has strict renderable TemplateDesign variants", () => {
  const kit = brandKit();
  const visibleById = new Map(builtInAdStudioTemplates().map((template) => [template.id, template]));

  for (const descriptor of EXTRACTED_META_TEMPLATE_DESCRIPTORS) {
    const template = visibleById.get(descriptor.id);
    assert.ok(template, `${descriptor.id} should be visible`);
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

test("extracted Meta gallery sample cards stay source-faithful to the selected originals", () => {
  for (const descriptor of EXTRACTED_META_TEMPLATE_DESCRIPTORS) {
    const bytes = readFileSync(`public/adstudio-samples/extracted-meta/${descriptor.id}.png`);
    assert.deepEqual(
      imageDimensionsFromBytes(bytes),
      { width: descriptor.imageSize.w, height: descriptor.imageSize.h },
      `${descriptor.id} sample card should preserve source image dimensions`,
    );
  }
});
