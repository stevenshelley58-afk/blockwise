import { z } from "zod";
import { COLOUR_ROLES, LAYER_TYPES, PLACEMENTS } from "./types.ts";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const safeZoneSchema = rectSchema;

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const fontRefSchema = z.object({
  file: z.string().min(1),
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/, "Must be a lowercase hex SHA-256"),
});

const imageSlotSchema = z.object({
  type: z.literal("image_slot"),
  layerId: z.string().min(1),
  inputKey: z.string().min(1),
  geometry: rectSchema,
  mask: z.enum(["rounded_rect", "circle", "none"]),
  minSourceWidth: z.number().int().positive(),
  minSourceHeight: z.number().int().positive(),
  defaultCrop: rectSchema,
  allowedPlacementOverrides: z.array(z.enum(["crop", "position"])),
});

const textLayerSchema = z.object({
  type: z.literal("text"),
  layerId: z.string().min(1),
  inputKey: z.string().min(1),
  font: fontRefSchema,
  fontSize: z.number().positive(),
  lineHeight: z.number().positive(),
  tracking: z.number(),
  alignment: z.enum(["left", "center", "right"]),
  maxCharacters: z.number().int().positive(),
  maxLines: z.number().int().positive(),
  colourRole: z.enum(COLOUR_ROLES),
  overflowBehaviour: z.enum(["refuse", "truncate", "scale_down"]),
});

const plateLayerSchema = z.object({
  type: z.literal("plate"),
  layerId: z.string().min(1),
  colourRole: z.enum(COLOUR_ROLES),
  assetKey: z.string().min(1).optional(),
  geometry: rectSchema,
  protected: z.boolean(),
});

const overlayPatchLayerSchema = z.object({
  type: z.literal("overlay_patch"),
  layerId: z.string().min(1),
  geometry: rectSchema,
  colourRole: z.enum(COLOUR_ROLES),
  opacity: z.number().min(0).max(1),
});

const logoLayerSchema = z.object({
  type: z.literal("logo"),
  layerId: z.string().min(1),
  geometry: rectSchema,
  inputKey: z.string().min(1),
});

const layoutLayerSchema = z.discriminatedUnion("type", [
  plateLayerSchema,
  imageSlotSchema,
  overlayPatchLayerSchema,
  textLayerSchema,
  logoLayerSchema,
]);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const placementSchema = z.enum(PLACEMENTS);

const layoutSchema = z.object({
  placement: placementSchema,
  layers: z.array(layoutLayerSchema).min(1),
  safeZones: z.array(safeZoneSchema).min(1),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const imageInputSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  acceptedTypes: z.array(z.string().min(1)).min(1),
});

const textInputSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  placeholder: z.string(),
  maxLength: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  label: z.string().min(1),
  modelVersion: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// TemplatePack
// ---------------------------------------------------------------------------

const colourRoleMapSchema = z.record(z.enum(COLOUR_ROLES), z.string().min(1));

const assetEntrySchema = z.object({
  fileName: z.string().min(1),
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
});

const previewEntrySchema = z.object({ sha256: z.string().length(64) });

const qaEvidenceSchema = z.object({
  feedPassed: z.boolean(),
  storyPassed: z.boolean(),
  reviewerVersions: z.array(z.string().min(1)).min(1),
  stressFixtureResults: z.record(z.string(), z.enum(["pass", "fail"])),
});

const assetRefSchema = z.object({
  assetKey: z.string().min(1),
  placement: z.enum(PLACEMENTS).nullable().optional(),
  purpose: z.enum(["gallery_sample", "replacement", "real_asset", "font"]).optional(),
  url: z.string().url().optional(),
});

const templateMetadataSchema = z.object({
  title: z.string().min(1), description: z.string(),
  gallerySamples: z.object({ feed: assetRefSchema, story: assetRefSchema }),
  metaCopyDefaults: z.object({
    primaryText: z.array(z.string()).max(5), headlines: z.array(z.string()).max(5),
    descriptions: z.array(z.string()).max(5), cta: z.string().min(1),
  }),
  aiWritingGuidance: z.object({ summary: z.string(), fields: z.record(z.string(), z.string()) }),
  publishRequirements: z.object({
    objective: z.string().min(1), specialAdCategory: z.string().nullable(),
    instantForm: z.object({ required: z.boolean(), dependency: z.string().nullable(), defaults: z.unknown().nullable().optional() }),
    destination: z.object({ required: z.boolean(), kind: z.enum(["url", "article", "instant_form", "none"]), dependency: z.string().nullable() }),
  }),
  replacementAssets: z.array(assetRefSchema), realAssetRefs: z.array(assetRefSchema),
});

export const templatePackSchema = z.object({
  schema: z.literal("blockwise.template-pack/v1"),
  templateId: z.string().min(1),
  version: z.number().int().positive(),
  packId: z.string().min(1),
  createdAt: z.string().datetime(),
  builderVersion: z.string().min(1),
  rendererVersion: z.string().min(1),
  classification: classificationSchema,
  manifestSha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  signature: z.string().min(1),
  feedLayout: layoutSchema,
  storyLayout: layoutSchema,
  imageInputs: z.array(imageInputSchema),
  textInputs: z.array(textInputSchema),
  semanticColours: colourRoleMapSchema,
  assets: z.record(z.string().min(1), assetEntrySchema),
  fonts: z.array(fontRefSchema),
  safePreviews: z.object({
    feed: previewEntrySchema,
    story: previewEntrySchema,
  }),
  qaEvidence: qaEvidenceSchema,
});

export type TemplatePackParsed = z.infer<typeof templatePackSchema>;

/** v2 extends the frozen v1 envelope with portable editor and publish metadata. */
export const templatePackV2Schema = templatePackSchema.extend({
  schema: z.literal("blockwise.template-pack/v2"), metadata: templateMetadataSchema,
});
export const templatePackAnySchema = z.union([templatePackV2Schema, templatePackSchema]);
export type TemplatePackV2Parsed = z.infer<typeof templatePackV2Schema>;

// ---------------------------------------------------------------------------
// AdDocument v1 (customer-side document referencing a pack)
// ---------------------------------------------------------------------------

// "custom" documents store the customer's per-role palette in
// resolvedColourMap. Older documents only ever contain "template" or
// "brand_pack", so the wider enum still parses every saved document.
export const colourModeSchema = z.enum(["template", "brand_pack", "custom"]);

export const adDocumentSchema = z.object({
  schema: z.literal("blockwise.ad-document/v1"),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  templateHash: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  rendererVersion: z.string().min(1),
  sharedImageValues: z.record(z.string().min(1), z.string().min(1)),
  sharedTextValues: z.record(z.string().min(1), z.string()),
  feedCropOverrides: z.record(z.string().min(1), rectSchema),
  storyCropOverrides: z.record(z.string().min(1), rectSchema),
  colourMode: colourModeSchema,
  resolvedColourMap: colourRoleMapSchema,
  metaPrimaryText: z.string(),
  metaHeadline: z.string(),
  metaDescription: z.string(),
  metaCta: z.string(),
  revision: z.number().int().positive(),
  documentHash: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  lastRenderedHash: z.string().length(64).regex(/^[a-f0-9]{64}$/).nullable(),
});

export type AdDocumentParsed = z.infer<typeof adDocumentSchema>;
