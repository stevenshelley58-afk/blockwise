// Server-side trace assembly for the operator template-trace inspector.
// Pure read-only reconstruction of the clone pipeline for any gallery template.

import {
  resolveAdStudioTemplate,
  resolvableAdStudioTemplates,
  type AdStudioTemplate,
} from "../adstudio/templates.ts";
import {
  buildCloneImageRequest,
  buildTargetedEditRequest,
  GLOBAL_CLONE_NEGATIVES,
  PHOTO_FIT_RULE,
  resolveCloneCopy,
} from "../adstudio/reference-clone.ts";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type TemplateTraceSummary = {
  id: string;
  name: string;
  format: string;
  goal: string;
  classification: AdStudioTemplate["classification"];
  tags: string[];
  thumbnailSrc: string;
  imageInputCount: number;
  textInputCount: number;
  hasSourceFile: boolean;
};

export function listTemplateTraces(): TemplateTraceSummary[] {
  return resolvableAdStudioTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    format: t.format,
    goal: t.goal,
    classification: t.classification,
    tags: t.tags,
    thumbnailSrc: t.sample.thumbnailSrc,
    imageInputCount: t.inputs.images.length,
    textInputCount: t.inputs.text.length,
    hasSourceFile: Boolean(t.sourceAd.file),
  }));
}

// ---------------------------------------------------------------------------
// Detail trace
// ---------------------------------------------------------------------------

export type TemplateTraceDetail = {
  template: AdStudioTemplate;
  /** The exact prompt that buildCloneImageRequest would send, reconstructed
   *  with the template's own sample values. */
  clonePrompt: string;
  negativePrompt: string;
  photoFitRule: string;
  /** Ordered reference asset descriptions. */
  referenceAssetOrder: string[];
  /** Resolved sample copy values (what the prompt embeds). */
  resolvedCopy: Record<string, string>;
  /** Example targeted-edit prompt for the first text field. */
  editPromptExample: string | null;
  sampleImagePath: string;
};

export function buildTemplateTrace(templateId: string): TemplateTraceDetail | null {
  const template = resolveAdStudioTemplate(templateId);
  if (!template) return null;

  // Reconstruct the clone prompt using sample values as placeholders.
  const placeholderImages: Record<string, string> = {};
  for (const img of template.inputs.images) {
    placeholderImages[img.key] = template.sample.imageSrc;
  }
  const request = buildCloneImageRequest(template, {
    images: placeholderImages,
    copy: {},
  });

  const resolvedCopy = resolveCloneCopy(template, {});

  // Build an example targeted-edit prompt for the first text field.
  let editPromptExample: string | null = null;
  const firstText = template.inputs.text[0];
  if (firstText) {
    const editRequest = buildTargetedEditRequest({
      currentImage: template.sample.imageSrc,
      fieldLabel: firstText.label,
      newValue: "REPLACEMENT TEXT",
      aspectRatio: template.format,
      expectedCopy: resolvedCopy,
    });
    editPromptExample = editRequest.prompt;
  }

  const referenceAssetOrder = [
    `1. Sample image (${template.sample.imageSrc}) — the design to clone`,
    ...template.inputs.images.map(
      (img, i) => `${i + 2}. ${img.label} (${img.key}) — ${img.description}`,
    ),
  ];

  return {
    template,
    clonePrompt: request.prompt,
    negativePrompt: request.negativePrompt ?? GLOBAL_CLONE_NEGATIVES,
    photoFitRule: PHOTO_FIT_RULE,
    referenceAssetOrder,
    resolvedCopy,
    editPromptExample,
    sampleImagePath: template.sample.imageSrc,
  };
}
