// Reference-clone generation: turn a gallery sample into a new ad by cloning its
// design from the sample image itself, swapping in the customer's photo(s) and copy.
//
// Why this exists: the gallery sample is the design source of truth. Instead of
// describing the layout in a long text prompt (brittle, bland), we pass the sample
// image as the FIRST reference asset ("clone this") and the customer's image(s)
// after it, then let the image model (gpt-image-2 edits / Gemini flash image) do
// the work. The per-template brief therefore only needs to declare the input
// contract (which images + which copy fields) and a short clone prompt.
//
// This module is the request builder + a thin generate wrapper. It is pure and
// dependency-light (no DB/auth) so it is unit-testable and runnable from a script.

import type { ImageProviderRequest } from "./providers.ts";

/** One image the customer must (or may) supply for a template, by role. */
export type CloneImageSlot = {
  role: string;
  objectId?: string;
  required: boolean;
  /** Hint for the upload UI / cropper, e.g. "landscape" | "square". */
  aspect?: string;
  /** Human description; also fed to the model as the reference-asset legend. */
  description?: string;
};

/** One editable copy field a template exposes. */
export type CloneCopyField = {
  key: string;
  label: string;
  maxLength?: number;
  default?: string;
  rules?: string;
};

/** The per-template extraction artifact: input contract + short clone prompt. */
export type TemplateCloneBrief = {
  templateId: string;
  name: string;
  /** "4:5" | "9:16" | "1:1". */
  aspectRatio: string;
  /** Path or URL to the gallery sample image whose design we clone. */
  referenceImage: string;
  imageSlots: CloneImageSlot[];
  copyFields: CloneCopyField[];
  /** Default brand accent hex; overridable per request from the brand kit. */
  brandHex: string;
  /**
   * Optional clone prompt with {copyKey} and {brandHex} placeholders. When
   * omitted, a generic clone prompt is built from the slots + copy fields, so a
   * brief can be pure data (the sample image carries the design).
   */
  clonePrompt?: string;
};

/**
 * Build a generic clone prompt from a brief's slots + copy fields. The reference
 * image carries the design, so this only has to say "clone it, swap these in".
 */
export function defaultClonePromptTemplate(brief: TemplateCloneBrief): string {
  const labelize = (s: string) => s.replace(/_/g, " ").trim();
  const copyList = brief.copyFields
    .map((f) => `set the ${labelize(f.label || f.key)} to "{${f.key}}"`)
    .join("; ");
  const copySentence = copyList ? ` Then ${copyList}.` : "";
  return [
    "Recreate the attached REFERENCE ad design (reference image 1) as closely as possible —",
    "identical layout, brand bar, logos, badges, colours, type treatment, accent shapes and composition.",
    "Replace the photo/image area(s) with the supplied customer image(s) (reference image 2 onward,",
    "in the given order), keeping them photoreal and unaltered." + copySentence,
    "Keep every line of copy crisp, legible, off the photos, and in the same positions and colour scheme as the reference.",
    `Render a clean, premium, photoreal ${brief.aspectRatio} Meta real-estate ad.`,
  ].join(" ");
}

/**
 * Global guardrails appended to every clone as the negative prompt. The two that
 * matter most for real estate: never alter the supplied property photo / agent
 * face, and never invent copy (prices, results). Keep this template-agnostic.
 */
export const GLOBAL_CLONE_NEGATIVES = [
  "do not invent or change any text beyond the provided copy",
  "do not distort, repaint, relight, or restructure the supplied property photo or agent face",
  "no extra logos, watermarks, captions, borders, or platform UI",
  "no fabricated prices, sale results, awards, or claims",
  "no warped windows, rooflines, faces, hands, or text",
  "keep every line of copy crisp, legible, and inside the canvas",
].join("; ");

export type CloneInputs = {
  /** Resolved reference design image (data: or http(s) URL). Defaults to brief.referenceImage. */
  referenceImage?: string;
  /** Customer images keyed by slot role (data: or http(s) URL). */
  images: Record<string, string>;
  /** Copy values keyed by field key; falls back to the field default. */
  copy?: Record<string, string>;
  /** Brand accent hex; falls back to brief.brandHex. */
  brandHex?: string;
  /** Override the brief aspect ratio if needed. */
  aspectRatio?: string;
  seed?: number;
};

/** Resolve each copy field to a final string (input → default), trimmed to maxLength. */
export function resolveCloneCopy(
  brief: TemplateCloneBrief,
  copy: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of brief.copyFields) {
    const raw = copy[field.key] ?? field.default;
    if (raw === undefined || raw === null) {
      throw new Error(`Missing copy for "${field.key}" (${field.label}) and no default is set.`);
    }
    const value = String(raw).trim();
    out[field.key] = field.maxLength ? value.slice(0, field.maxLength) : value;
  }
  return out;
}

/** Replace every {token} in `template` using the supplied values. Unknown tokens are left intact. */
function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

/**
 * Build the image-provider request for a reference clone. Reference order is the
 * contract the prompt relies on: index 1 is always the design to clone, then the
 * customer images in declared slot order (only the ones supplied).
 */
export function buildCloneImageRequest(brief: TemplateCloneBrief, inputs: CloneInputs): ImageProviderRequest {
  const images = inputs.images ?? {};

  const missing = brief.imageSlots.filter((slot) => slot.required && !images[slot.role]?.trim());
  if (missing.length) {
    throw new Error(`Missing required image(s): ${missing.map((slot) => slot.role).join(", ")}`);
  }

  const referenceImage = (inputs.referenceImage ?? brief.referenceImage)?.trim();
  if (!referenceImage) {
    throw new Error("A reference design image is required to clone.");
  }

  // Supplied slots, in the brief's declared order (stable, drives the legend).
  const suppliedSlots = brief.imageSlots.filter((slot) => images[slot.role]?.trim());
  const referenceAssets = [referenceImage, ...suppliedSlots.map((slot) => images[slot.role].trim())];

  const copy = resolveCloneCopy(brief, inputs.copy);
  const brandHex = (inputs.brandHex ?? brief.brandHex).trim();

  const template = brief.clonePrompt ?? defaultClonePromptTemplate(brief);
  const body = interpolate(template, { ...copy, brandHex });
  const legend = [
    "Reference image 1 = the finished ad design to clone exactly.",
    ...suppliedSlots.map((slot, index) => `Reference image ${index + 2} = ${slot.description ?? slot.role} (use as supplied, do not alter).`),
  ].join(" ");

  return {
    prompt: `${body}\n${legend}`,
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets,
    aspectRatio: inputs.aspectRatio ?? brief.aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: inputs.seed ?? 0,
  };
}

