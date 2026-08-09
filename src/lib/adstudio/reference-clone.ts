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
  /** Template is the safe default and preserves the approved sample palette. */
  colourSource?: "template" | "brand";
  /** Labelled Brand Pack colours supplied only when colourSource is brand. */
  brandColours?: string[];
  aspectRatio?: string;
  seed?: number;
  /** Ephemeral image-model QA feedback for rebuilding a rejected full clone.
   * It is never stored as a layout recipe and never changes the reference contract. */
  reviewCorrection?: string;
};

export const GLOBAL_CLONE_NEGATIVES = [
  "do not retain any name, phone number, URL, handle, logo, address, price, or identifying detail from reference image 1",
  "do not invent or change any text beyond the supplied text values",
  "do not distort, repaint, relight, or restructure the original visible content of supplied property photos, logos, or faces",
  "do not crop away the main subject of a supplied photo; a house, room, or person must never be cut off to fit the frame",
  "no extra logos, watermarks, captions, borders, or platform UI",
  "no fabricated prices, sale results, awards, or claims",
  "no warped windows, rooflines, faces, hands, logos, or text",
  "keep every supplied text value crisp, legible, and inside the canvas",
].join("; ");

/**
 * Subject-invariant definition of likeness. The replaceable photo/logo content
 * is deliberately different; the reusable ad system around and over it must
 * stay faithful to the approved design.
 */
export const AD_SYSTEM_CLONE_CONTRACT = [
  "Treat reference image 1 as a pixel-level design blueprint, not as a source of customer content.",
  "Match the reusable ad system exactly: canvas and card geometry, borders, corner radii, margins, image-area geometry, logo anchor, text-block positions, line breaks, type scale and weight, alignment, hierarchy, whitespace, shapes, CTA treatment, and footer treatment.",
  "For replacement copy, preserve each reference text block's outer bounds, number of lines, line rhythm, alignment, and visual weight; fit the exact new wording inside those same bounds with only the smallest necessary type-size, tracking, or line-break adjustment.",
  "For a replacement logo, preserve the reference logo's displayed bounding box, anchor, clear space, and visual weight regardless of the supplied logo file's intrinsic canvas or aspect ratio; never let a simpler mark become larger or more dominant.",
  "When replacing an image, keep every template-applied effect that sits around or over that image: its crop or fit behaviour, mask, border, radius, fade, gradient, veil, overlay, shadow, reflection, blend, blur, colour treatment, and overlap with other design elements.",
  "Every reference image slot is immovable: preserve its exact position, width, height, mask, and boundary even when the replacement asset has a different aspect ratio. Fit, crop, or naturally extend the replacement only inside that fixed slot; never enlarge, shrink, or move the slot or displace surrounding text and footer elements to accommodate the asset.",
  "The replacement image subject is intentionally different and must not be made to resemble the subject in reference image 1.",
  "Do not redesign, modernise, simplify, decorate, rebalance, or reinterpret the composition.",
].join(" ");

/**
 * How a supplied photo is fitted into the design's photo area when their aspect
 * ratios differ. Extending the scene at the edges is explicitly permitted so the
 * model is not forced into a destructive crop by the no-repaint rule above.
 */
export const PHOTO_FIT_RULE =
  "The photo area's position, width, height, mask, and boundary from reference image 1 are fixed and take priority; never resize or move that area to fit the supplied photo. " +
  "Fit each supplied photo inside that unchanged area so its main subject stays completely in frame. " +
  "If the photo's aspect ratio does not match its area, choose the better of two options: " +
  "crop only when the crop still shows the entire main subject; " +
  "otherwise extend the photo by continuing its own scene naturally past its original edges (more sky, lawn, driveway, wall, or surroundings that match its lighting and perspective). " +
  "Never solve an aspect-ratio mismatch by changing the template layout, cutting off part of the main subject, stretching, squashing, or adding invented objects to the photo.";

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
  const colourSource = inputs.colourSource ?? "template";
  const brandColours = [...new Set((inputs.brandColours ?? []).map((colour) => colour.trim()).filter(Boolean))];
  const colourInstruction = colourSource === "brand"
    ? `Colour instruction: adapt the design to this Brand Pack palette: ${brandColours.join(", ") || "the colours visible in the supplied brand logo"}. Preserve the reference design's contrast, hierarchy, typography, spacing, shapes, and image treatment.`
    : "Colour instruction: preserve the exact colour palette of reference image 1. Do not recolour the design to match the supplied logo or Brand Pack.";
  const reviewCorrection = inputs.reviewCorrection?.trim();

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
      "Clone reference image 1 as closely as possible.",
      AD_SYSTEM_CLONE_CONTRACT,
      ...(reviewCorrection
        ? [`Image-model QA correction from the previous candidate: ${reviewCorrection} Apply only these corrections to make this clone more faithful to reference image 1; they do not authorize any other redesign.`]
        : []),
      assetLegend,
      "Customer asset replacement is mandatory: reference image 1 controls the design only; never retain a source image where a supplied replacement asset belongs.",
      ...(suppliedImages.length ? [PHOTO_FIT_RULE] : []),
      `Use these exact visible text values and no others: ${copyLegend}.`,
      "Every supplied text value is mandatory: render each value character-for-character exactly once, fully visible, and at a readable size.",
      colourInstruction,
      `Produce one finished ${aspectRatio} Meta real-estate ad with no Meta interface chrome.`,
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
    ? `Reference image 1 is an existing finished ad. Replace only the ${inputs.fieldLabel} with reference image 2, fitted naturally into the same area. ${PHOTO_FIT_RULE}${requestedChange ? ` Apply this direction only to the replacement: ${requestedChange}.` : ""} Keep every other pixel, including all text, layout, colours, logos, and other photos, unchanged.${preservationInstruction}`
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
