import type { ImageProviderRequest } from "./providers.ts";
import type { AdStudioTemplate } from "./templates.ts";

/** The one input shape used for gallery-sample clones and customer ad clones. */
export type CloneInputs = {
  /** The design image to clone. Gallery creation uses the private source ad;
   * customer generation uses the approved public sample. */
  referenceImage?: string;
  /** Customer or sample images keyed by template.inputs.images[].key. */
  images: Record<string, string>;
  /** Exact visible text keyed by template.inputs.text[].key. */
  copy?: Record<string, string>;
  brandHex?: string;
  aspectRatio?: string;
  seed?: number;
};

export const GLOBAL_CLONE_NEGATIVES = [
  "do not retain any name, phone number, URL, handle, logo, address, price, or identifying detail from reference image 1",
  "do not invent or change any text beyond the supplied text values",
  "do not distort, repaint, relight, or restructure supplied property photos, logos, or faces",
  "no extra logos, watermarks, captions, borders, or platform UI",
  "no fabricated prices, sale results, awards, or claims",
  "no warped windows, rooflines, faces, hands, logos, or text",
  "keep every supplied text value crisp, legible, and inside the canvas",
].join("; ");

/** Resolve every declared field to exact text, using the safe sample value only
 * when a caller does not provide a replacement. */
export function resolveCloneCopy(
  template: AdStudioTemplate,
  copy: Record<string, string> = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const field of template.inputs.text) {
    const raw = copy[field.key] ?? field.sample;
    const value = String(raw ?? "").trim();
    if (field.required && !value) throw new Error(`Missing text: ${field.label}`);
    resolved[field.key] = value.slice(0, field.maxLength);
  }
  return resolved;
}

/**
 * Build the only full-ad generation request.
 *
 * Reference order is contractual: image 1 is the approved design sample (or
 * the private source while creating that sample), followed by the declared
 * customer assets in template order.
 */
export function buildCloneImageRequest(template: AdStudioTemplate, inputs: CloneInputs): ImageProviderRequest {
  const images = inputs.images ?? {};
  const missingImages = template.inputs.images.filter((input) => input.required && !images[input.key]?.trim());
  if (missingImages.length) {
    throw new Error(`Missing required image(s): ${missingImages.map((input) => input.label).join(", ")}`);
  }

  const referenceImage = (inputs.referenceImage ?? template.sample.imageSrc)?.trim();
  if (!referenceImage) throw new Error("A reference ad image is required.");

  const suppliedImages = template.inputs.images.filter((input) => images[input.key]?.trim());
  const copy = resolveCloneCopy(template, inputs.copy);
  const aspectRatio = inputs.aspectRatio ?? template.format;
  const brandHex = inputs.brandHex?.trim() || "use the supplied logo's brand colours";

  const assetLegend = [
    "Reference image 1 is the ad design to clone.",
    ...suppliedImages.map(
      (input, index) => `Reference image ${index + 2} is ${input.description}. Replace the matching asset in the design with it.`,
    ),
  ].join(" ");
  const copyLegend = template.inputs.text
    .map((field) => `${field.label}: "${copy[field.key]}"`)
    .join("; ");

  return {
    prompt: [
      "Clone reference image 1 as closely as possible, preserving its composition, spacing, typography, visual hierarchy, shapes, and image treatment.",
      assetLegend,
      "Customer asset replacement is mandatory: reference image 1 controls the design only; never retain a source image where a supplied replacement asset belongs.",
      `Use these exact visible text values and no others: ${copyLegend}.`,
      "Every supplied text value is mandatory: render each value character-for-character exactly once, fully visible, and at a readable size.",
      `Use ${brandHex}. Produce one finished ${aspectRatio} Meta real-estate ad with no Meta interface chrome.`,
    ].join(" "),
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets: [referenceImage, ...suppliedImages.map((input) => images[input.key].trim())],
    aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: inputs.seed ?? 0,
  };
}

export type TargetedEditInputs = {
  currentImage: string;
  fieldLabel: string;
  newValue: string;
  newImage?: string;
  /** Natural-language direction for a selected image region. */
  editInstruction?: string;
  expectedCopy?: Record<string, string>;
  aspectRatio: string;
  seed?: number;
};

/** Build a single-element edit anchored on the current finished ad. */
export function buildTargetedEditRequest(inputs: TargetedEditInputs): ImageProviderRequest {
  const referenceAssets = inputs.newImage ? [inputs.currentImage, inputs.newImage] : [inputs.currentImage];
  const preservationContract = Object.entries(inputs.expectedCopy ?? {})
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("; ");
  const preservationInstruction = preservationContract
    ? ` Every listed text value must remain visible and character-for-character exact: ${preservationContract}.`
    : "";
  const requestedChange = inputs.editInstruction?.trim();
  const instruction = inputs.newImage
    ? `Reference image 1 is an existing finished ad. Replace only the ${inputs.fieldLabel} with reference image 2, fitted naturally into the same area.${requestedChange ? ` Apply this direction only to the replacement: ${requestedChange}.` : ""} Keep every other pixel, including all text, layout, colours, logos, and other photos, unchanged.${preservationInstruction}`
    : requestedChange
      ? `Reference image 1 is an existing finished ad. Change only the ${inputs.fieldLabel} according to this direction: ${requestedChange}. Keep every other pixel, including all text, layout, colours, logos, and other photos, unchanged.${preservationInstruction}`
      : `Reference image 1 is an existing finished ad. Change only the ${inputs.fieldLabel} so it reads exactly "${inputs.newValue}" in the same position and type treatment. Keep every other pixel unchanged.${preservationInstruction}`;

  return {
    prompt: instruction,
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets,
    aspectRatio: inputs.aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: inputs.seed ?? 0,
  };
}

/** Build the quality pass without changing the finished design. */
export function buildRefineRequest(inputs: { currentImage: string; aspectRatio: string; seed?: number }): ImageProviderRequest {
  return {
    prompt:
      "Reference image 1 is a finished ad. Re-render this exact ad at maximum fidelity. Keep its layout, colours, every text string, logos, and photos unchanged; improve only rendering quality and text sharpness.",
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets: [inputs.currentImage],
    aspectRatio: inputs.aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: inputs.seed ?? 0,
  };
}
