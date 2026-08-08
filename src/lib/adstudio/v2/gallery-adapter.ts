import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AdStudioTemplate, AdStudioTypeSpec } from "../templates";
import { templateDocV2Schema } from "./template-doc";
import { redactTemplateV2ForCustomer } from "./template-resolver";

/**
 * Track E gallery merge: when ADSTUDIO_TEMPLATES_V2 is on, the NewAdDialog
 * grid lists `ready` v2 templates, adapted to the v1 AdStudioTemplate shape
 * the dialog already renders. v1 templates stay out of the list while v2 is
 * on (cutover); v1 remains the list when the flag is off.
 */
export function v2ReadyTemplatesAsV1(): AdStudioTemplate[] {
  const gallery = join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2");
  if (!existsSync(gallery)) return [];
  const out: AdStudioTemplate[] = [];
  for (const id of readdirSync(gallery)) {
    const path = join(gallery, id, "template.json");
    if (!existsSync(path)) continue;
    let doc;
    try {
      doc = templateDocV2Schema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      continue;
    }
    if (doc.exactness.status !== "ready") continue;
    const customerDoc = redactTemplateV2ForCustomer(doc);
    const feed = customerDoc.formats.feed;
    out.push({
      id: customerDoc.id,
      name: customerDoc.name,
      goal: customerDoc.goal,
      offerId: customerDoc.offerId,
      source: "builtin",
      status: "approved",
      format: "4:5",
      dimensions: { width: feed.width, height: feed.height },
      audienceIntent: customerDoc.audienceIntent,
      category: customerDoc.category,
      tags: customerDoc.tags,
      sample: {
        imageSrc: customerDoc.provenance.sample.imageSrc,
        thumbnailSrc: customerDoc.provenance.sample.imageSrc,
        alt: customerDoc.name,
        contentHash: customerDoc.provenance.sample.contentHash,
        // v2 samples are deterministic renders, not reference clones; the v1
        // union predates v2. Cast to the wider semantics.
        generatedBy: "deterministic_render",
      } as unknown as AdStudioTemplate["sample"],
      inputs: {
        images: customerDoc.inputs.images.map((image) => ({
          key: image.key,
          label: image.label,
          required: image.required,
          description: image.description,
        })),
        text: customerDoc.inputs.text.map((text) => ({
          key: text.key,
          label: text.label,
          required: text.required,
          maxLength: text.maxLength,
          sample: text.sample,
        })),
      },
      meta: {
        platform: "meta",
        specialAdCategory: customerDoc.publish.specialAdCategory,
        primaryText: customerDoc.publish.copy.primaryText,
        headlines: customerDoc.publish.copy.headlines,
        descriptions: customerDoc.publish.copy.descriptions,
        cta: customerDoc.publish.cta,
        leadForm: {
          headline: customerDoc.publish.leadForm.headline,
          questions: customerDoc.publish.leadForm.questions,
          privacyPolicyUrl: null,
          thankYouScreen: customerDoc.publish.leadForm.thankYou,
        },
        objective: "OUTCOME_LEADS",
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: customerDoc.publish.placements.facebookPositions,
        instagramPositions: customerDoc.publish.placements.instagramPositions,
      },
      sourceAd: customerDoc.provenance.sourceAd,
      classification: customerDoc.classification,
      typography: Object.fromEntries(
        feed.layers
          .filter((layer): layer is Extract<typeof layer, { type: "text" }> => layer.type === "text")
          .map((layer) => [
            layer.inputKey,
            {
              measurementVersion: layer.measurement.version,
              measurementSource: layer.measurement.source,
              measuredLines: layer.typo.measuredLines,
              fontId: layer.typo.fontId,
              family: layer.typo.family,
              fallbackFamily: layer.typo.fallbackFamily,
              weight: layer.typo.weight,
              italic: layer.typo.italic,
              case: layer.typo.case,
              sizeRatio: layer.typo.sizeRatio,
              lineHeight: layer.typo.lineHeight,
              tracking: layer.typo.tracking,
              align: layer.typo.align,
              color: layer.typo.color,
              fitScore: layer.measurement.fitScore,
              sampleLineCount: layer.typo.measuredLines?.length ?? 1,
              sample: customerDoc.inputs.text.find((text) => text.key === layer.inputKey)?.sample ?? "",
              maxLength: layer.constraints.maxLength,
            } as unknown as AdStudioTypeSpec,
          ]),
      ),
      deterministicEditing: {
        status: "ready",
        imageBoxes: Object.fromEntries(
          feed.layers
            .filter((layer) => layer.type === "image_slot")
            .map((layer) => [layer.inputKey, layer.box]),
        ),
      },
    });
  }
  return out;
}
