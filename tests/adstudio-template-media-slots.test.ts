import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateRenderFrame,
  resolveTemplateDesignForFormat,
} from "../src/lib/adstudio/index.ts";
import { GOLD_AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/gold-adstudio-templates.ts";
import type { AdStudioFormat } from "../src/lib/adstudio/types.ts";

const FORMATS = ["4:5", "9:16", "1:1"] as const satisfies readonly AdStudioFormat[];

test("gold templates expose image slots for every required Meta format", () => {
  assert.equal(GOLD_AD_STUDIO_TEMPLATES.length, 50);

  for (const template of GOLD_AD_STUDIO_TEMPLATES) {
    for (const format of FORMATS) {
      const design = resolveTemplateDesignForFormat(template, format);
      assert.ok(design, `${template.id} should have ${format} design`);

      const imageSlots = design.layers.filter((layer) => layer.type === "image_slot");
      assert.ok(imageSlots.some((slot) => slot.id === "primary_photo"), `${template.id} ${format} needs primary_photo`);
      assert.ok(imageSlots.every((slot) => slot.editorLabel), `${template.id} ${format} image slots need labels`);
      assert.ok(imageSlots.every((slot) => slot.guidance), `${template.id} ${format} image slots need guidance`);
      assert.ok(imageSlots.every((slot) => slot.required === true), `${template.id} ${format} image slots should be required`);

      const frame = buildTemplateRenderFrame({ template, format });
      assert.equal(frame.imageSlots.length, imageSlots.length, `${template.id} ${format} frame should mirror design image slots`);
      assert.ok(frame.copySafeZones.some((zone) => zone.id === "headline"), `${template.id} ${format} needs headline safe zone`);
      assert.ok(frame.copySafeZones.some((zone) => zone.id === "cta"), `${template.id} ${format} needs CTA safe zone`);
    }
  }
});

test("feed-led and story-led templates prioritize the intended placement geometry", () => {
  for (const template of GOLD_AD_STUDIO_TEMPLATES) {
    const numericId = Number(template.id.slice("meta_".length));
    const priorityFormat: AdStudioFormat = numericId <= 26 ? "4:5" : "9:16";
    const design = resolveTemplateDesignForFormat(template, priorityFormat);
    assert.ok(design);

    const primary = design.layers.find((layer) => layer.type === "image_slot" && layer.id === "primary_photo");
    const imageArea = design.layers
      .filter((layer) => layer.type === "image_slot")
      .reduce((total, slot) => total + slot.rect.w * slot.rect.h, 0);
    assert.ok(primary, `${template.id} should expose primary_photo`);
    assert.ok(
      imageArea >= 0.3,
      `${template.id} ${priorityFormat} image slots should be visually dominant`,
    );
  }
});

test("gold template text slots carry editing limits and guidance", () => {
  for (const template of GOLD_AD_STUDIO_TEMPLATES) {
    for (const format of FORMATS) {
      const design = resolveTemplateDesignForFormat(template, format);
      assert.ok(design);

      for (const layer of design.layers) {
        if (layer.type === "text") {
          assert.ok(layer.maxChars, `${template.id} ${format} ${layer.id} needs maxChars`);
          assert.ok(layer.maxLines, `${template.id} ${format} ${layer.id} needs maxLines`);
          assert.ok(layer.editorLabel, `${template.id} ${format} ${layer.id} needs editorLabel`);
          assert.ok(layer.copyField, `${template.id} ${format} ${layer.id} needs copyField`);
          assert.ok(layer.guidance, `${template.id} ${format} ${layer.id} needs guidance`);
        }

        if (layer.type === "cta_button") {
          assert.ok(layer.maxChars, `${template.id} ${format} CTA needs maxChars`);
          assert.ok(layer.maxLines, `${template.id} ${format} CTA needs maxLines`);
          assert.ok(layer.editorLabel, `${template.id} ${format} CTA needs editorLabel`);
          assert.equal(layer.copyField, "cta");
          assert.ok(layer.guidance, `${template.id} ${format} CTA needs guidance`);
        }
      }
    }
  }
});
