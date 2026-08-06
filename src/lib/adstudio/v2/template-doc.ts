// AdStudio Template Doc v2 — THE contract.
//
// A template is a layered document decomposed directly from one real source ad:
// a background plate of the designer's original pixels, image slots the customer
// fills, overlay patches (original pixels that sit above slots), and measured
// text layers re-typeset from the customer's copy. Every loader validates at
// parse time — same fail-at-import philosophy as v1's validateGalleryTemplate.
//
// The types below are normative. The zod schemas enforce the structural rules
// that keep a template honest; the asset/hash/diversity checks that need the
// filesystem live in scripts/verify/adstudio-templates-v2.mjs.
//
// This module is isomorphic on purpose: the browser editor imports it for
// guided-mode guard rails. Hashing needs node:crypto, so it lives next door in
// ./template-hash.ts.

import { z } from "zod";

import { adStudioGoalSchema, type AdStudioGoal } from "../types.ts";

// ─── constants ───────────────────────────────────────────────────────────────

/** Boxes are normalized 0..1; allow a hair of float slop at the far edge. */
export const BOX_BOUND_TOLERANCE = 0.001;

/** Two text boxes may not overlap by more than this share of the smaller box. */
export const TEXT_OVERLAP_MAX_RATIO = 0.05;

/**
 * Meta story safe zones at 1080x1920. Top/bottom are hard failures for text.
 * Reels needs more bottom clearance, but that is a Studio warning — the same
 * story layout serves both placements.
 */
export const STORY_SAFE_ZONE_TOP_PX = 250;
export const STORY_SAFE_ZONE_BOTTOM_PX = 340;
export const REELS_BOTTOM_CLEARANCE_PX = 672;

/** Grayscale RMSE ceiling per text region (plan §10.2). Over this cannot ship. */
export const TEMPLATE_RESIDUAL_MAX = 0.14;

/** Shrink-to-fit floor for a text layer; below it the renderer refuses. */
export const DEFAULT_AUTO_FIT_MIN_RATIO = 0.85;

/** Meta hard limits on the publish copy arrays. */
export const META_COPY_LIMITS = { primaryText: 125, headline: 40, description: 90 } as const;
export const META_COPY_MAX_ENTRIES = 5;

export const TEMPLATE_FORMAT_DIMENSIONS = {
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
} as const;

/**
 * Meta's documented lead-ad CTA subset (Appendix A). The full
 * AdCreativeLinkDataCallToAction enum is ~119 values; most are invalid for lead
 * ads and CONTACT_US is undocumented for them. Track D aligns
 * src/lib/adstudio/meta-cta.ts to this list; this is the contract's copy.
 */
export const META_LEAD_CTA_VALUES = [
  "APPLY_NOW",
  "DOWNLOAD",
  "GET_QUOTE",
  "LEARN_MORE",
  "SIGN_UP",
  "SUBSCRIBE",
] as const;

export type MetaLeadCta = (typeof META_LEAD_CTA_VALUES)[number];

// ─── geometry ────────────────────────────────────────────────────────────────

/** All boxes normalized 0..1 against the layout's width/height. */
export type NormBox = { x: number; y: number; width: number; height: number };

// ─── template doc ────────────────────────────────────────────────────────────

export type TemplatePublishDefaults = {
  platform: "meta";
  objective: "OUTCOME_LEADS";
  specialAdCategory: "housing";
  apiVersionMin: "v26.0";
  copy: { primaryText: string[]; headlines: string[]; descriptions: string[] };
  cta: MetaLeadCta;
  leadForm: {
    headline: string;
    questions: string[];
    thankYou: { title: string; body: string };
  };
  placements: {
    publisherPlatforms: Array<"facebook" | "instagram">;
    facebookPositions: string[];
    instagramPositions: string[];
  };
  /** Which of our formats serves which placement (drives asset_feed_spec rules). */
  formatRouting: { feed: "4:5"; story: "9:16" | null };
  /** Explicit Advantage+ creative feature enrollment — default all OPT_OUT. */
  creativeFeatures: Record<string, "OPT_IN" | "OPT_OUT">;
  previewFormats: string[];
};

export type TemplateLayerBase = { id: string; z: number; box: NormBox; rotation?: number };

export type ImageSlotLayer = TemplateLayerBase & {
  type: "image_slot";
  inputKey: string;
  fit: "cover";
  /** Default focal point for the cover crop; customer can pan/zoom within the slot. */
  focal?: { x: number; y: number };
  mask: { kind: "rect" | "rounded" | "ellipse"; radius?: number };
  /**
   * Minimum customer-photo resolution; default = the slot's own px size at
   * canvas res. Below 1.0x is an editor warning; below 0.5x a hard block.
   */
  minSourcePx?: { width: number; height: number };
};

export type TextLayer = TemplateLayerBase & {
  type: "text";
  inputKey: string;
  typo: {
    fontId: string;
    family: string;
    fallbackFamily: "serif" | "sans-serif" | "monospace" | "cursive";
    weight: number;
    italic: boolean;
    case: "upper" | "lower" | "mixed" | "none";
    /** fontSize = box.height(px) * sizeRatio */
    sizeRatio: number;
    lineHeight: number;
    /** em */
    tracking: number;
    align: "left" | "center" | "right";
    color: string;
    /** carried over from v1 measurement — drives per-line fidelity */
    measuredLines?: Array<{ text: string; box: NormBox; sizeRatio: number; scaleX?: number }>;
    effects?: {
      /** width = box.height * ratio */
      stroke?: { color: string; widthRatio: number };
      /** dx/dy normalized against the box */
      shadow?: { color: string; blurRatio: number; dx: number; dy: number };
      gradientFill?: { from: string; to: string; angleDeg: number };
    };
  };
  constraints: { maxLength: number; maxLines: number; autoFitMinRatio: number };
  /** provenance of the spec — carried from the v1 measurement pipeline */
  measurement: {
    fitScore: number;
    detectionScore: number;
    source: "ocr-v2" | "manual-verified";
    version: number;
  };
};

export type OverlayPatchLayer = TemplateLayerBase & {
  /** original RGBA pixels above slots (panels, borders, badges) */
  type: "overlay_patch";
  src: string;
  sha256: string;
};

export type TemplateLayer = ImageSlotLayer | TextLayer | OverlayPatchLayer;

export type TemplateLayout = {
  format: "4:5" | "9:16";
  width: 1080; height: 1350 | 1920;
  /** Full-bleed raster: the SOURCE ad with text regions inpainted away and slot regions
   *  left as-is (slots draw OVER the plate). Restyle palette remaps are applied where the
   *  operator recolours plate elements (deterministic hue remap, recorded in restyle).
   *  Lossless WebP. */
  plate: { src: string; sha256: string };
  /** True for the source-native surface (story-first sources); absent for
   *  derived band layouts and feeds. */
  native?: boolean;
  /** z-ordered ABOVE the plate, ascending. */
  layers: TemplateLayer[];
};

export type AdTemplateDocV2 = {
  schema: "adstudio.template.v2";
  /** === filename stem, ^meta-[a-z0-9-]+$ */
  id: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  category: string;
  tags: string[];
  audienceIntent: string;
  classification: { ad_type: string; primary_intent: string; property_or_agent_focus: string };

  provenance: {
    sourceAd: { creativeId?: string; file?: string; contentHash: string };
    /** The public gallery sample is a DETERMINISTIC RENDER of the restyled doc. */
    sample: { imageSrc: string; contentHash: string; generatedBy: "deterministic_render" };
    /** Layers derive from the real source ad's pixels. */
    decomposedFrom: "source";
  };

  /** Mandatory Studio restyle evidence; "ready" requires it non-trivial. */
  restyle: {
    /** #source -> #safe colour remaps applied to text/effects */
    paletteMap: Record<string, string>;
    /** slot inputKeys filled with generic assets in the sample */
    replacedAssets: string[];
    note?: string;
  };

  /**
   * Every font used by any text layer. Files live in public/fonts/adstudio/ and
   * must appear in public/fonts/adstudio/manifest.json with matching sha256.
   */
  fonts: Array<{
    fontId: string;
    family: string;
    weight: number;
    italic: boolean;
    file: string;
    sha256: string;
  }>;

  /** story required for status "ready" */
  formats: { feed: TemplateLayout; story?: TemplateLayout };

  /** Customer input contract — declare only what the source uses. */
  inputs: {
    images: Array<{
      key: string;
      label: string;
      required: boolean;
      aspect?: "landscape" | "portrait" | "square";
      description: string;
    }>;
    text: Array<{ key: string; label: string; required: boolean; maxLength: number; sample: string }>;
  };

  publish: TemplatePublishDefaults;

  editPolicy: {
    mode: "guided";
    advancedUnlockable: boolean;
    /** Per-layer hard locks that even Advanced mode cannot change. */
    lockedLayerIds: string[];
  };

  exactness: {
    status: "draft" | "qa" | "ready";
    /** Per text-LAYER-ID residual from the gate (0 = identical, lower is better). */
    residuals: Record<string, number>;
    /** Regions deliberately left as original pixels (not editable). */
    bakedTextKeys: string[];
    qaBy?: string;
    qaAt?: string;
  };
};

// ─── instance doc ────────────────────────────────────────────────────────────

export type AdDocInstance = {
  schema: "adstudio.instance.v2";
  templateId: string;
  /**
   * SHA-256 of the canonical-JSON template doc at instantiation — renders are
   * reproducible even after a template is later re-QA'd.
   */
  templateHash: string;
  format: "4:5" | "9:16";
  values: {
    images: Record<
      string,
      {
        /** AdStudioImageSrc rules (image-src.ts) */
        src: string;
        /** customer pan */
        focal?: { x: number; y: number };
        /** 1..3, cover-crop zoom */
        zoom?: number;
      }
    >;
    text: Record<string, string>;
  };
  /** Advanced-mode deltas, empty in guided mode. Applied after template layers. */
  overrides: Array<
    | { layerId: string; op: "move"; box: NormBox }
    | { layerId: string; op: "font-size"; sizeRatio: number }
    | { layerId: string; op: "align"; align: "left" | "center" | "right" }
    /** brand-palette values only in guided */
    | { layerId: string; op: "color"; color: string }
  >;
  /** media paths of the last canonical render */
  renders?: { feed?: string; story?: string };
};

// ─── shared geometry helpers (reused by the verify gate) ─────────────────────

export function isNormalizedBox(box: NormBox | undefined | null): boolean {
  if (!box) return false;
  const values = [box.x, box.y, box.width, box.height];
  if (!values.every((value) => Number.isFinite(value))) return false;
  return (
    box.x >= 0
    && box.y >= 0
    && box.width > 0
    && box.height > 0
    && box.x + box.width <= 1 + BOX_BOUND_TOLERANCE
    && box.y + box.height <= 1 + BOX_BOUND_TOLERANCE
  );
}

/** Intersection area as a share of the SMALLER box (v1 gate's metric). */
export function boxOverlapRatio(left: NormBox, right: NormBox): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? (width * height) / smaller : 0;
}

/** Which story safe zone a box breaks, if any. Heights are normalized to 1920. */
export function storySafeZoneViolation(box: NormBox, height: number): "top" | "bottom" | null {
  const top = STORY_SAFE_ZONE_TOP_PX / height;
  const bottom = (height - STORY_SAFE_ZONE_BOTTOM_PX) / height;
  if (box.y < top) return "top";
  if (box.y + box.height > bottom) return "bottom";
  return null;
}

// ─── canonical JSON ──────────────────────────────────────────────────────────

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Stable-key JSON for hashing. Key order in a template.json file must never
 * change the template's identity, so every object's keys are sorted before
 * serialization while array order (z-order!) is preserved verbatim.
 */
export function normalizeCanonicalJson(doc: unknown): string {
  return JSON.stringify(sortKeysDeep(doc));
}

// ─── zod: leaves ─────────────────────────────────────────────────────────────

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, "must be a lowercase #rrggbb colour");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest");
const unitScoreSchema = z.number().min(0).max(1);
const publicPathSchema = z.string().regex(/^\/[^\s]+$/, "must be a rooted public path");
const nonEmptyString = z.string().min(1);

const normBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .refine(isNormalizedBox, "box must be normalized 0..1 and non-degenerate");

const focalSchema = z.object({ x: unitScoreSchema, y: unitScoreSchema });

const layerBaseShape = {
  id: nonEmptyString,
  z: z.number().int().min(0),
  box: normBoxSchema,
  rotation: z.number().optional(),
};

const imageSlotLayerSchema = z
  .object({
    ...layerBaseShape,
    type: z.literal("image_slot"),
    inputKey: nonEmptyString,
    fit: z.literal("cover"),
    focal: focalSchema.optional(),
    mask: z.object({
      kind: z.enum(["rect", "rounded", "ellipse"]),
      radius: z.number().positive().optional(),
    }),
    minSourcePx: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .optional(),
  });

const textLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("text"),
  inputKey: nonEmptyString,
  typo: z.object({
    fontId: nonEmptyString,
    family: nonEmptyString,
    fallbackFamily: z.enum(["serif", "sans-serif", "monospace", "cursive"]),
    weight: z.number().int().min(100).max(1000),
    italic: z.boolean(),
    case: z.enum(["upper", "lower", "mixed", "none"]),
    sizeRatio: z.number().positive(),
    lineHeight: z.number().positive(),
    tracking: z.number(),
    align: z.enum(["left", "center", "right"]),
    color: hexColorSchema,
    measuredLines: z
      .array(
        z.object({
          text: z.string(),
          box: normBoxSchema,
          sizeRatio: z.number().positive(),
          scaleX: z.number().positive().optional(),
        }),
      )
      .min(1)
      .optional(),
    effects: z
      .object({
        stroke: z.object({ color: hexColorSchema, widthRatio: z.number().positive() }).optional(),
        shadow: z
          .object({
            color: hexColorSchema,
            blurRatio: z.number().min(0),
            dx: z.number(),
            dy: z.number(),
          })
          .optional(),
        gradientFill: z
          .object({ from: hexColorSchema, to: hexColorSchema, angleDeg: z.number() })
          .optional(),
      })
      .optional(),
  }),
  constraints: z.object({
    maxLength: z.number().int().positive(),
    maxLines: z.number().int().positive(),
    autoFitMinRatio: z.number().positive().max(1),
  }),
  measurement: z.object({
    fitScore: unitScoreSchema,
    detectionScore: unitScoreSchema,
    source: z.enum(["ocr-v2", "manual-verified"]),
    version: z.number().int().positive(),
  }),
});

const overlayPatchLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("overlay_patch"),
  src: publicPathSchema,
  sha256: sha256Schema,
});

const templateLayerSchema = z.discriminatedUnion("type", [
  imageSlotLayerSchema,
  textLayerSchema,
  overlayPatchLayerSchema,
]);

const templateLayoutSchema = z
  .object({
    format: z.enum(["4:5", "9:16"]),
    width: z.literal(1080),
    height: z.union([z.literal(1350), z.literal(1920)]),
    plate: z.object({ src: publicPathSchema, sha256: sha256Schema }),
    layers: z.array(templateLayerSchema),
    /** True when the layout is the source-native surface (decomposed from a
     *  9:16 source); absent for feeds and derived band layouts. */
    native: z.boolean().optional(),
  })
  .refine(
    (layout) => layout.height === TEMPLATE_FORMAT_DIMENSIONS[layout.format].height,
    "layout height must match its format (4:5 = 1350, 9:16 = 1920)",
  )
  .refine(
    (layout) =>
      layout.layers.every(
        (layer) =>
          layer.type !== "image_slot" || layer.mask.kind !== "rounded" || layer.mask.radius !== undefined,
      ),
    "a rounded slot mask needs an explicit corner radius (px @1080w)",
  );

const publishDefaultsSchema = z.object({
  platform: z.literal("meta"),
  objective: z.literal("OUTCOME_LEADS"),
  specialAdCategory: z.literal("housing"),
  apiVersionMin: z.literal("v26.0"),
  copy: z.object({
    primaryText: z.array(z.string().min(1).max(META_COPY_LIMITS.primaryText)).min(1).max(META_COPY_MAX_ENTRIES),
    headlines: z.array(z.string().min(1).max(META_COPY_LIMITS.headline)).min(1).max(META_COPY_MAX_ENTRIES),
    descriptions: z.array(z.string().min(1).max(META_COPY_LIMITS.description)).min(1).max(META_COPY_MAX_ENTRIES),
  }),
  cta: z.enum(META_LEAD_CTA_VALUES),
  leadForm: z.object({
    headline: nonEmptyString,
    questions: z.array(nonEmptyString).min(1),
    thankYou: z.object({ title: nonEmptyString, body: nonEmptyString }),
  }),
  placements: z.object({
    publisherPlatforms: z.array(z.enum(["facebook", "instagram"])).min(1),
    facebookPositions: z.array(nonEmptyString),
    instagramPositions: z.array(nonEmptyString),
  }),
  formatRouting: z.object({
    feed: z.literal("4:5"),
    story: z.union([z.literal("9:16"), z.null()]),
  }),
  creativeFeatures: z.record(z.string(), z.enum(["OPT_IN", "OPT_OUT"])),
  previewFormats: z.array(nonEmptyString).min(1),
});

// ─── zod: the doc ────────────────────────────────────────────────────────────

const templateDocShapeSchema = z.object({
  schema: z.literal("adstudio.template.v2"),
  id: z.string().regex(/^meta-[a-z0-9-]+$/, "id must match ^meta-[a-z0-9-]+$"),
  name: nonEmptyString,
  goal: adStudioGoalSchema,
  offerId: nonEmptyString,
  category: nonEmptyString,
  tags: z.array(nonEmptyString),
  audienceIntent: nonEmptyString,
  classification: z.object({
    ad_type: nonEmptyString,
    primary_intent: nonEmptyString,
    property_or_agent_focus: nonEmptyString,
  }),
  provenance: z.object({
    sourceAd: z
      .object({
        creativeId: nonEmptyString.optional(),
        file: nonEmptyString.optional(),
        contentHash: sha256Schema,
      })
      .refine(
        (source) => Boolean(source.creativeId ?? source.file),
        "sourceAd needs a creativeId or a file — provenance is not optional",
      ),
    sample: z.object({
      imageSrc: publicPathSchema,
      contentHash: sha256Schema,
      generatedBy: z.literal("deterministic_render"),
    }),
    decomposedFrom: z.literal("source"),
  }),
  restyle: z.object({
    paletteMap: z.record(hexColorSchema, hexColorSchema),
    replacedAssets: z.array(nonEmptyString),
    note: z.string().optional(),
  }),
  fonts: z.array(
    z.object({
      fontId: nonEmptyString,
      family: nonEmptyString,
      weight: z.number().int().min(100).max(1000),
      italic: z.boolean(),
      file: publicPathSchema,
      sha256: sha256Schema,
    }),
  ),
  formats: z.object({ feed: templateLayoutSchema, story: templateLayoutSchema.optional() }),
  inputs: z.object({
    images: z.array(
      z.object({
        key: nonEmptyString,
        label: nonEmptyString,
        required: z.boolean(),
        aspect: z.enum(["landscape", "portrait", "square"]).optional(),
        description: nonEmptyString,
      }),
    ),
    text: z.array(
      z.object({
        key: nonEmptyString,
        label: nonEmptyString,
        required: z.boolean(),
        maxLength: z.number().int().positive(),
        sample: z.string(),
      }),
    ),
  }),
  publish: publishDefaultsSchema,
  editPolicy: z.object({
    mode: z.literal("guided"),
    advancedUnlockable: z.boolean(),
    lockedLayerIds: z.array(nonEmptyString),
  }),
  exactness: z.object({
    status: z.enum(["draft", "qa", "ready"]),
    residuals: z.record(z.string(), unitScoreSchema),
    bakedTextKeys: z.array(nonEmptyString),
    qaBy: nonEmptyString.optional(),
    qaAt: z.string().datetime().optional(),
  }),
});

type TemplateDocShape = z.infer<typeof templateDocShapeSchema>;

type FormatKey = "feed" | "story";

function formatEntries(doc: TemplateDocShape): Array<[FormatKey, TemplateLayout]> {
  const entries: Array<[FormatKey, TemplateLayout]> = [["feed", doc.formats.feed as TemplateLayout]];
  if (doc.formats.story) entries.push(["story", doc.formats.story as TemplateLayout]);
  return entries;
}

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

/**
 * Every declared input must be reachable and every layer must be declared —
 * no orphans in either direction, per format. A template that promises the
 * customer a field it never draws (or draws a field it never asks for) is the
 * exact failure v1's gate existed to prevent.
 */
function checkInputContract(doc: TemplateDocShape, ctx: z.RefinementCtx): void {
  const imageKeys = new Set(doc.inputs.images.map((input) => input.key));
  const textKeys = new Set(doc.inputs.text.map((input) => input.key));
  const bakedKeys = new Set(doc.exactness.bakedTextKeys);

  const seenImageKeys = new Set<string>();
  for (const input of doc.inputs.images) {
    if (seenImageKeys.has(input.key)) addIssue(ctx, ["inputs", "images"], `duplicate image input key ${input.key}`);
    seenImageKeys.add(input.key);
  }
  const seenTextKeys = new Set<string>();
  for (const input of doc.inputs.text) {
    if (seenTextKeys.has(input.key)) addIssue(ctx, ["inputs", "text"], `duplicate text input key ${input.key}`);
    seenTextKeys.add(input.key);
  }

  for (const key of bakedKeys) {
    if (!textKeys.has(key)) {
      addIssue(ctx, ["exactness", "bakedTextKeys"], `baked key ${key} is not a declared text input`);
    }
  }

  const editableTextKeys = [...textKeys].filter((key) => !bakedKeys.has(key));

  for (const [formatKey, layout] of formatEntries(doc)) {
    const base = ["formats", formatKey] as const;
    const layerIds = new Set<string>();
    const coveredText = new Set<string>();
    const coveredImages = new Set<string>();

    for (const [index, layer] of layout.layers.entries()) {
      if (layerIds.has(layer.id)) {
        addIssue(ctx, [...base, "layers", index, "id"], `duplicate layer id ${layer.id}`);
      }
      layerIds.add(layer.id);

      if (layer.type === "text") {
        if (!textKeys.has(layer.inputKey)) {
          addIssue(
            ctx,
            [...base, "layers", index, "inputKey"],
            `text layer ${layer.id} references undeclared text input ${layer.inputKey}`,
          );
        } else if (bakedKeys.has(layer.inputKey)) {
          addIssue(
            ctx,
            [...base, "layers", index, "inputKey"],
            `text layer ${layer.id} renders baked key ${layer.inputKey} — baked text stays in the plate`,
          );
        }
        coveredText.add(layer.inputKey);
      }

      if (layer.type === "image_slot") {
        if (!imageKeys.has(layer.inputKey)) {
          addIssue(
            ctx,
            [...base, "layers", index, "inputKey"],
            `image slot ${layer.id} references undeclared image input ${layer.inputKey}`,
          );
        }
        coveredImages.add(layer.inputKey);
      }
    }

    for (const key of editableTextKeys) {
      if (!coveredText.has(key)) {
        addIssue(ctx, [...base, "layers"], `text input ${key} has no text layer in ${formatKey}`);
      }
    }
    for (const key of imageKeys) {
      if (!coveredImages.has(key)) {
        addIssue(ctx, [...base, "layers"], `image input ${key} has no image slot in ${formatKey}`);
      }
    }
  }

  const allLayerIds = new Set(
    formatEntries(doc).flatMap(([, layout]) => layout.layers.map((layer) => layer.id)),
  );
  for (const id of doc.editPolicy.lockedLayerIds) {
    if (!allLayerIds.has(id)) {
      addIssue(ctx, ["editPolicy", "lockedLayerIds"], `locked layer ${id} does not exist`);
    }
  }
  for (const id of Object.keys(doc.exactness.residuals)) {
    if (!allLayerIds.has(id)) {
      addIssue(ctx, ["exactness", "residuals"], `residual ${id} is not a layer id`);
    }
  }
}

/** A text layer may only use a face the doc actually ships and licenses. */
function checkFontResolution(doc: TemplateDocShape, ctx: z.RefinementCtx): void {
  const faces = new Map(
    doc.fonts.map((face) => [`${face.fontId}:${face.weight}:${face.italic}`, face]),
  );

  for (const [formatKey, layout] of formatEntries(doc)) {
    for (const [index, layer] of layout.layers.entries()) {
      if (layer.type !== "text") continue;
      const { fontId, weight, italic, family } = layer.typo;
      const face = faces.get(`${fontId}:${weight}:${italic}`);
      const path = ["formats", formatKey, "layers", index, "typo"];
      if (!face) {
        addIssue(
          ctx,
          path,
          `no fonts[] entry for ${fontId} weight ${weight}${italic ? " italic" : ""}`,
        );
        continue;
      }
      if (face.family !== family) {
        addIssue(ctx, [...path, "family"], `family ${family} does not match fonts[] family ${face.family}`);
      }
    }
  }
}

/** Overlapping text boxes mean one of the two measurements is wrong. */
function checkTextOverlap(doc: TemplateDocShape, ctx: z.RefinementCtx): void {
  for (const [formatKey, layout] of formatEntries(doc)) {
    const texts = layout.layers.filter((layer): layer is TextLayer => layer.type === "text");
    for (let left = 0; left < texts.length; left += 1) {
      for (let right = left + 1; right < texts.length; right += 1) {
        const ratio = boxOverlapRatio(texts[left]!.box, texts[right]!.box);
        if (ratio > TEXT_OVERLAP_MAX_RATIO) {
          addIssue(
            ctx,
            ["formats", formatKey, "layers"],
            `text layers ${texts[left]!.id} and ${texts[right]!.id} overlap by ${(ratio * 100).toFixed(1)}% (max ${TEXT_OVERLAP_MAX_RATIO * 100}%)`,
          );
        }
      }
    }
  }
}

/**
 * Meta crops the top 250 px and bottom 340 px of a story behind its own chrome.
 * Text there is not "a bit tight" — it is invisible. Draft/qa docs may carry
 * source-native text there (a design decision the Studio resolves before
 * ready); the shipped status is what the hard rule guards.
 */
function checkStorySafeZones(doc: TemplateDocShape, ctx: z.RefinementCtx): void {
  if (doc.exactness.status !== "ready") return;
  const story = doc.formats.story;
  if (!story) return;
  for (const [index, layer] of story.layers.entries()) {
    if (layer.type !== "text") continue;
    const violation = storySafeZoneViolation(layer.box, story.height);
    if (violation) {
      addIssue(
        ctx,
        ["formats", "story", "layers", index, "box"],
        `text layer ${layer.id} sits inside the story ${violation} safe zone (${violation === "top" ? STORY_SAFE_ZONE_TOP_PX : STORY_SAFE_ZONE_BOTTOM_PX} px)`,
      );
    }
  }
}

/** Restyle evidence: a palette remap, or generic assets in every required slot. */
export function hasNonTrivialRestyle(doc: Pick<AdTemplateDocV2, "restyle" | "inputs">): boolean {
  if (Object.keys(doc.restyle.paletteMap).length > 0) return true;
  const requiredImageKeys = doc.inputs.images.filter((input) => input.required).map((input) => input.key);
  if (requiredImageKeys.length === 0) return false;
  const replaced = new Set(doc.restyle.replacedAssets);
  return requiredImageKeys.every((key) => replaced.has(key));
}

/**
 * "ready" is the only status a customer ever sees, so it carries every promise:
 * both formats authored, a human signature, residuals inside the fidelity gate,
 * and real restyle distance from the source ad.
 */
function checkReadyImplications(doc: TemplateDocShape, ctx: z.RefinementCtx): void {
  if (doc.exactness.status !== "ready") return;

  if (!doc.formats.story) {
    addIssue(ctx, ["formats", "story"], 'status "ready" requires an authored story layout');
  }
  if (!doc.exactness.qaBy) {
    addIssue(ctx, ["exactness", "qaBy"], 'status "ready" requires qaBy — a person approves, not the AI critic');
  }
  if (!doc.exactness.qaAt) {
    addIssue(ctx, ["exactness", "qaAt"], 'status "ready" requires qaAt');
  }

  for (const [formatKey, layout] of formatEntries(doc)) {
    for (const [index, layer] of layout.layers.entries()) {
      if (layer.type !== "text") continue;
      const residual = doc.exactness.residuals[layer.id];
      if (residual === undefined) {
        addIssue(
          ctx,
          ["exactness", "residuals"],
          `text layer ${layer.id} (${formatKey}) has no recorded residual`,
        );
        continue;
      }
      if (residual > TEMPLATE_RESIDUAL_MAX) {
        addIssue(
          ctx,
          ["formats", formatKey, "layers", index],
          `text layer ${layer.id} residual ${residual} exceeds ${TEMPLATE_RESIDUAL_MAX} — fix the spec or mark it baked`,
        );
      }
    }
  }

  if (!hasNonTrivialRestyle(doc as unknown as AdTemplateDocV2)) {
    addIssue(
      ctx,
      ["restyle"],
      'status "ready" requires non-trivial restyle evidence: a non-empty paletteMap or generic assets in every required slot',
    );
  }

  if (doc.provenance.sample.contentHash === doc.provenance.sourceAd.contentHash) {
    addIssue(
      ctx,
      ["provenance", "sample", "contentHash"],
      "the public sample hash must differ from the source ad hash",
    );
  }
}

export const templateDocV2Schema = templateDocShapeSchema.superRefine((doc, ctx) => {
  checkInputContract(doc, ctx);
  checkFontResolution(doc, ctx);
  checkTextOverlap(doc, ctx);
  checkStorySafeZones(doc, ctx);
  checkReadyImplications(doc, ctx);
});

// ─── zod: the instance ───────────────────────────────────────────────────────

export const adDocInstanceSchema = z.object({
  schema: z.literal("adstudio.instance.v2"),
  templateId: z.string().regex(/^meta-[a-z0-9-]+$/),
  templateHash: sha256Schema,
  format: z.enum(["4:5", "9:16"]),
  values: z.object({
    images: z.record(
      z.string(),
      z.object({
        src: nonEmptyString,
        focal: focalSchema.optional(),
        zoom: z.number().min(1).max(3).optional(),
      }),
    ),
    text: z.record(z.string(), z.string()),
  }),
  overrides: z.array(
    z.discriminatedUnion("op", [
      z.object({ layerId: nonEmptyString, op: z.literal("move"), box: normBoxSchema }),
      z.object({ layerId: nonEmptyString, op: z.literal("font-size"), sizeRatio: z.number().positive() }),
      z.object({
        layerId: nonEmptyString,
        op: z.literal("align"),
        align: z.enum(["left", "center", "right"]),
      }),
      z.object({ layerId: nonEmptyString, op: z.literal("color"), color: hexColorSchema }),
    ]),
  ),
  renders: z.object({ feed: z.string().optional(), story: z.string().optional() }).optional(),
});

/** Cheap tag check for persistence read paths that must not mangle a v2 doc. */
export function isAdDocInstanceShape(value: unknown): value is AdDocInstance {
  return (
    value !== null
    && typeof value === "object"
    && (value as { schema?: unknown }).schema === "adstudio.instance.v2"
  );
}

// ─── compile-time proof the schemas produce the normative §3 types ───────────

type AssertTrue<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

export type TemplateDocV2SchemaMatchesContract = AssertTrue<
  Extends<z.infer<typeof templateDocV2Schema>, AdTemplateDocV2>
>;
export type AdDocInstanceSchemaMatchesContract = AssertTrue<
  Extends<z.infer<typeof adDocInstanceSchema>, AdDocInstance>
>;
