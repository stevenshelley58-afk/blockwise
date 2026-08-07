import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AdStudioTemplate, AdStudioTypeSpec } from "../templates";
import { templateDocV2Schema } from "./template-doc";

/**
 * Track E gallery merge: when ADSTUDIO_TEMPLATES_V2 is on, the NewAdDialog
 * grid lists `ready` v2 templates, adapted to the v1 AdStudioTemplate shape
 * the dialog already renders. v1 templates stay out of the list while v2 is
 * on (cutover); v1 remains the list when the flag is off.
 */
export function v2ReadyTemplatesAsV1(repoRoot: string): AdStudioTemplate[] {
  const gallery = join(repoRoot, "src", "lib", "adstudio", "template-gallery-v2");
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
    const feed = doc.formats.feed;
    out.push({
      id: doc.id,
      name: doc.name,
      goal: doc.goal,
      offerId: doc.offerId,
      source: "builtin",
      status: "approved",
      format: "4:5",
      dimensions: { width: feed.width, height: feed.height },
      audienceIntent: doc.audienceIntent,
      category: doc.category,
      tags: doc.tags,
      sample: {
        imageSrc: doc.provenance.sample.imageSrc,
        thumbnailSrc: doc.provenance.sample.imageSrc,
        alt: doc.name,
        contentHash: doc.provenance.sample.contentHash,
        // v2 samples are deterministic renders, not reference clones; the v1
        // union predates v2. Cast to the wider semantics.
        generatedBy: "deterministic_render",
      } as unknown as AdStudioTemplate["sample"],
      inputs: {
        images: doc.inputs.images.map((image) => ({
          key: image.key,
          label: image.label,
          required: image.required,
          description: image.description,
        })),
        text: doc.inputs.text.map((text) => ({
          key: text.key,
          label: text.label,
          required: text.required,
          maxLength: text.maxLength,
          sample: text.sample,
        })),
      },
      meta: {
        platform: "meta",
        specialAdCategory: doc.publish.specialAdCategory,
        primaryText: doc.publish.copy.primaryText,
        headlines: doc.publish.copy.headlines,
        descriptions: doc.publish.copy.descriptions,
        cta: doc.publish.cta,
        leadForm: {
          headline: doc.publish.leadForm.headline,
          questions: doc.publish.leadForm.questions,
          privacyPolicyUrl: null,
          thankYouScreen: doc.publish.leadForm.thankYou,
        },
        objective: "OUTCOME_LEADS",
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: doc.publish.placements.facebookPositions,
        instagramPositions: doc.publish.placements.instagramPositions,
      },
      sourceAd: doc.provenance.sourceAd,
      classification: doc.classification,
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
              sample: doc.inputs.text.find((text) => text.key === layer.inputKey)?.sample ?? "",
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
