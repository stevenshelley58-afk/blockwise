import { z } from "zod";
import {
  MINIMUM_MULTILINE_LINE_HEIGHT,
  MINIMUM_TEXT_SIZE_PX,
  MINIMUM_VECTOR_LINE_LENGTH_PX,
  SUPPORTED_ICON_NAMES,
} from "./types.ts";

const colourRoleSchema = z.enum(["background", "primary", "secondary", "accent", "mainText", "inverseText"]);
const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict();
const fontSchema = z.object({ file: z.string().min(1) }).strict();
const shadowSchema = z.object({ colourRole: colourRoleSchema, opacity: z.number().min(0).max(1), blur: z.number().min(0).max(100), offsetX: z.number().finite().min(-200).max(200), offsetY: z.number().finite().min(-200).max(200) }).strict();
const strokeSchema = z.object({ colourRole: colourRoleSchema, opacity: z.number().min(0).max(1), width: z.number().positive().max(100) }).strict();
const effectsSchema = z.object({ rotationDegrees: z.number().finite().min(-180).max(180).optional(), blendMode: z.enum(["source-over", "multiply", "screen", "overlay", "darken", "lighten"]).optional(), shadow: shadowSchema.optional(), stroke: strokeSchema.optional() }).strict();
const gradientSchema = z.object({ type: z.literal("linear_gradient"), angleDegrees: z.number().finite(), stops: z.array(z.object({ offset: z.number().min(0).max(1), colourRole: colourRoleSchema, opacity: z.number().min(0).max(1) }).strict()).min(2).max(16) }).strict();
const appearanceShape = { effects: effectsSchema.optional(), fill: gradientSchema.optional(), cornerRadius: z.number().min(0).max(540).optional() };

function resolveRect(
  geometry: z.infer<typeof rectSchema>,
  width: number,
  height: number,
): z.infer<typeof rectSchema> {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height];
  if (values.every((value) => Math.abs(value) <= 1.001)) {
    return {
      x: geometry.x * width,
      y: geometry.y * height,
      width: geometry.width * width,
      height: geometry.height * height,
    };
  }
  return geometry;
}

const layerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plate"), layerId: z.string().min(1), colourRole: colourRoleSchema, assetKey: z.string().min(1).optional(), geometry: rectSchema, protected: z.boolean(), ...appearanceShape }).strict(),
  z.object({ type: z.literal("image_slot"), layerId: z.string().min(1), inputKey: z.string().min(1), geometry: rectSchema, mask: z.enum(["rounded_rect", "circle", "none"]), minSourceWidth: z.number().int().positive(), minSourceHeight: z.number().int().positive(), defaultCrop: rectSchema, allowedPlacementOverrides: z.array(z.enum(["crop", "position"])), effects: effectsSchema.optional(), cornerRadius: z.number().min(0).max(540).optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal("overlay_patch"), layerId: z.string().min(1), geometry: rectSchema, colourRole: colourRoleSchema, opacity: z.number().min(0).max(1), assetKey: z.string().min(1).optional(), ...appearanceShape }).strict(),
  z.object({ type: z.literal("text"), layerId: z.string().min(1), inputKey: z.string().min(1), font: fontSchema, fontSize: z.number().positive(), sizeRatio: z.number().finite().positive().optional(), fontFamily: z.string().min(1).optional(), fontWeight: z.number().int().min(100).max(900).optional(), italic: z.boolean().optional(), case: z.enum(["upper", "lower", "none"]).optional(), opacity: z.number().min(0).max(1).optional(), effects: effectsSchema.optional(), lineHeight: z.number().positive(), tracking: z.number().finite().min(-4).max(4), alignment: z.enum(["left", "center", "right"]), maxCharacters: z.number().int().positive(), maxLines: z.number().int().positive(), colourRole: colourRoleSchema, overflowBehaviour: z.enum(["refuse", "truncate", "scale_down"]), geometry: rectSchema }).strict(),
  z.object({ type: z.literal("logo"), layerId: z.string().min(1), inputKey: z.string().min(1), geometry: rectSchema, effects: effectsSchema.optional(), cornerRadius: z.number().min(0).max(540).optional(), opacity: z.number().min(0).max(1).optional() }).strict(),
  z.object({ type: z.literal("vector"), layerId: z.string().min(1), geometry: rectSchema, shape: z.enum(["rect", "rounded", "circle", "line", "pill", "notched", "wave", "ring"]), colourRole: colourRoleSchema, opacity: z.number().min(0).max(1), ...appearanceShape }).strict(),
  z.object({ type: z.literal("icon"), layerId: z.string().min(1), geometry: rectSchema, icon: z.enum(SUPPORTED_ICON_NAMES), colourRole: colourRoleSchema, opacity: z.number().min(0).max(1).optional(), effects: effectsSchema.optional() }).strict(),
]);

const layoutSchema = z.object({
  placement: z.enum(["feed", "story"]),
  layers: z.array(layerSchema).min(1).max(256),
  safeZones: z.array(rectSchema).max(32),
}).strict().superRefine((layout, ctx) => {
  const width = 1080;
  const height = layout.placement === "feed" ? 1350 : 1920;
  const minimumTextSize = MINIMUM_TEXT_SIZE_PX[layout.placement];
  const background = layout.layers[0];
  const backgroundGeometry = background ? resolveRect(background.geometry, width, height) : null;
  if (
    background?.type !== "plate"
    || !background.protected
    || !backgroundGeometry
    || Math.abs(backgroundGeometry.x) > 0.5
    || Math.abs(backgroundGeometry.y) > 0.5
    || Math.abs(backgroundGeometry.width - width) > 0.5
    || Math.abs(backgroundGeometry.height - height) > 0.5
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${layout.placement} first layer must be a protected full-canvas background plate`,
    });
  }
  for (const layer of layout.layers) {
    const geometry = resolveRect(layer.geometry, width, height);
    if (geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.width > width || geometry.y + geometry.height > height) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "layer geometry is outside placement bounds" });
    }
    if (layer.type === "text" && layer.fontSize < minimumTextSize) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${layout.placement} text must be at least ${minimumTextSize}px` });
    }
    if (layer.type === "text" && layer.maxLines > 1 && layer.lineHeight < MINIMUM_MULTILINE_LINE_HEIGHT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${layout.placement} text layer ${layer.layerId} with maxLines ${layer.maxLines} must use lineHeight at least ${MINIMUM_MULTILINE_LINE_HEIGHT}`,
      });
    }
    if (layer.type === "vector" && layer.shape === "ring") {
      const squareTolerance = Math.max(1, Math.min(geometry.width, geometry.height) * 0.01);
      if (Math.abs(geometry.width - geometry.height) > squareTolerance) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ring vectors must use square geometry" });
      }
    }
    if (layer.type === "vector" && layer.shape === "line" && Math.max(geometry.width, geometry.height) < MINIMUM_VECTOR_LINE_LENGTH_PX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${layout.placement} line vector ${layer.layerId} must be at least ${MINIMUM_VECTOR_LINE_LENGTH_PX}px long`,
      });
    }
  }
  for (const zone of layout.safeZones) {
    const geometry = resolveRect(zone, width, height);
    if (geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.width > width || geometry.y + geometry.height > height) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safe zone is outside placement bounds" });
    }
  }
});

const imageInputSchema = z.object({
  key: z.string().min(1), label: z.string().min(1), required: z.boolean().optional(),
  acceptedTypes: z.array(z.string().min(1)).min(1), defaultAssetKey: z.string().min(1).optional(),
}).strict();
const textInputSchema = z.object({
  key: z.string().min(1), label: z.string().min(1), placeholder: z.string(), maxLength: z.number().int().positive(),
}).strict();
const gallerySampleSchema = z.object({
  assetKey: z.string().min(1).optional(), placement: z.enum(["feed", "story"]), purpose: z.string().min(1),
}).strict();
const formQuestionSchema = z.object({ key: z.string().min(1), label: z.string().min(1), type: z.enum(["short_answer", "email", "phone", "multiple_choice"]), required: z.boolean(), options: z.array(z.string().min(1)).optional() }).strict();
const generationReviewSchema = z.object({
  process: z.literal("exact-clone"), sourcePlacement: z.enum(["feed", "story"]), targetPlacement: z.enum(["feed", "story"]),
  likenessThreshold: z.number().min(9.8).max(10),
  comparator: z.object({ overall: z.number().min(0).max(10), geometry: z.number().min(0).max(10), colourEffects: z.number().min(0).max(10), compositionCrop: z.number().min(0).max(10), typography: z.number().min(0).max(10), decision: z.enum(["revise", "ready"]) }).strict(),
  finalReviewers: z.array(z.object({ id: z.string().min(1), route: z.string().min(1), overall: z.number().min(0).max(10), minimum: z.number().min(9.5).max(10), decision: z.enum(["pass", "fail"]) }).strict()).length(2),
  warnings: z.array(z.string()), fontSubstitution: z.object({ source: z.string().min(1), used: z.string().min(1), reason: z.string().min(1) }).strict().nullable(),
}).strict();

const metadataSchema = z.object({
  title: z.string().min(1), description: z.string(),
  gallerySamples: z.object({ feed: gallerySampleSchema.optional(), story: gallerySampleSchema.optional() }).strict(),
  metaCopyDefaults: z.object({ primaryText: z.array(z.string()), headlines: z.array(z.string()), descriptions: z.array(z.string()), cta: z.string() }).strict(),
  aiWritingGuidance: z.object({ summary: z.string(), fields: z.record(z.string()) }).strict(),
  publishRequirements: z.object({
    objective: z.string().min(1), specialAdCategory: z.string().nullable(),
    instantForm: z.object({ required: z.boolean(), dependency: z.string().nullable(), defaults: z.object({ formName: z.string().optional(), introHeadline: z.string().optional(), introBody: z.string().optional(), questions: z.array(formQuestionSchema).optional(), privacyPolicyUrl: z.string().url().optional(), disclaimer: z.string().optional(), thankYouHeadline: z.string().optional(), thankYouBody: z.string().optional(), thankYouAction: z.enum(["visit_website", "download", "call_business", "none"]).optional(), thankYouUrl: z.string().url().optional() }).strict().optional() }).strict(),
    destination: z.object({ required: z.boolean(), kind: z.enum(["website", "instant_form", "none"]), dependency: z.string().nullable() }).strict(),
    fulfilment: z.object({ required: z.boolean(), dependency: z.string().nullable(), deliveryMethod: z.enum(["website", "email", "download", "manual"]).optional(), deliveryUrl: z.string().url().nullable().optional(), owner: z.string().nullable().optional() }).strict().optional(),
    offer: z.object({ name: z.string().min(1), promise: z.string().nullable(), terms: z.array(z.string()), eligibility: z.string().nullable(), expiresAt: z.string().datetime().nullable() }).strict().nullable().optional(),
    claims: z.array(z.object({ text: z.string().min(1), kind: z.enum(["factual", "testimonial", "guarantee", "performance"]), evidenceRequired: z.boolean(), evidenceReference: z.string().nullable(), qualifier: z.string().nullable(), disclaimer: z.string().nullable() }).strict()).optional(),
    requiredCtaTypes: z.array(z.string()).default([]),
  }).strict(),
  replacementAssets: z.array(z.object({ inputKey: z.string().min(1), assetKey: z.string().min(1), purpose: z.string().optional() }).strict()),
  realAssetRefs: z.array(z.object({ inputKey: z.string().min(1), kind: z.string().min(1), required: z.boolean() }).strict()),
  generationReview: generationReviewSchema.optional(),
}).strict();

export const adTemplateSchema = z.object({
  schema: z.literal("blockwise.ad-template"), templateId: z.string().min(1).max(160), createdAt: z.string().datetime(),
  feedLayout: layoutSchema.refine((value) => value.placement === "feed"),
  storyLayout: layoutSchema.refine((value) => value.placement === "story"),
  imageInputs: z.array(imageInputSchema), textInputs: z.array(textInputSchema),
  semanticColours: z.object({ background: z.string().min(1), primary: z.string().min(1), secondary: z.string().min(1), accent: z.string().min(1), mainText: z.string().min(1), inverseText: z.string().min(1) }).strict(),
  assets: z.record(z.object({ fileName: z.string().min(1), mimeType: z.string().min(1) }).strict()),
  fonts: z.array(fontSchema), metadata: metadataSchema,
}).strict().superRefine((template, ctx) => {
  const report = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const inputKeys = [...template.imageInputs.map((input) => input.key), ...template.textInputs.map((input) => input.key)];
  if (new Set(inputKeys).size !== inputKeys.length) report("input keys must be unique across image and text inputs");
  const fontFiles = template.fonts.map((font) => font.file);
  if (new Set(fontFiles).size !== fontFiles.length) report("font files must be unique");
  const assetKeys = new Set(Object.keys(template.assets));
  const declaredInputs = new Set(inputKeys);
  for (const input of template.imageInputs) {
    if (input.defaultAssetKey && !assetKeys.has(input.defaultAssetKey)) report("image default asset is not declared");
  }
  const allLayers = [...template.feedLayout.layers, ...template.storyLayout.layers];
  const layerIds = allLayers.map((layer) => layer.layerId);
  if (new Set(layerIds).size !== layerIds.length) report("layer IDs must be unique across placements");
  for (const layer of allLayers) {
    if ("inputKey" in layer && !declaredInputs.has(layer.inputKey)) report("layer input is not declared");
    if ("assetKey" in layer && layer.assetKey && !assetKeys.has(layer.assetKey)) report("layer asset is not declared");
    if (layer.type === "text" && !fontFiles.includes(layer.font.file)) report("text font is not declared");
    if (layer.type === "text") {
      const input = template.textInputs.find((candidate) => candidate.key === layer.inputKey);
      const hardLineCount = input?.placeholder.split(/\r\n?|\n/u).length ?? 0;
      if (hardLineCount > layer.maxLines) report("text placeholder hard lines exceed the referencing layer maxLines");
    }
  }
  const feedSample = template.metadata.gallerySamples.feed;
  if (feedSample && feedSample.placement !== "feed") report("feed gallery sample must use feed placement");
  const storySample = template.metadata.gallerySamples.story;
  if (storySample && storySample.placement !== "story") report("story gallery sample must use story placement");
  const replacementKeys = new Set<string>();
  for (const replacement of template.metadata.replacementAssets) {
    if (!declaredInputs.has(replacement.inputKey)) report("replacement input is not declared");
    if (!assetKeys.has(replacement.assetKey)) report("replacement asset is not declared");
    const key = replacement.inputKey + ":" + replacement.assetKey;
    if (replacementKeys.has(key)) report("replacement mappings must be unique");
    replacementKeys.add(key);
  }
  for (const ref of template.metadata.realAssetRefs) {
    if (!declaredInputs.has(ref.inputKey)) report("real asset input is not declared");
    if (!ref.kind.trim()) report("real asset kind is required");
  }
  const review = template.metadata.generationReview;
  if (review) {
    if (review.comparator.decision !== "ready" || review.comparator.overall < review.likenessThreshold) {
      report("generation comparator must meet the likeness threshold and be ready");
    }
    if (new Set(review.finalReviewers.map((reviewer) => reviewer.id)).size !== review.finalReviewers.length) {
      report("final generation reviewers must be independent");
    }
    if (new Set(review.finalReviewers.map((reviewer) => reviewer.route)).size !== review.finalReviewers.length) {
      report("final generation reviewer routes must be independent");
    }
    for (const reviewer of review.finalReviewers) {
      if (reviewer.decision !== "pass" || reviewer.overall < reviewer.minimum) report("final generation reviewer did not pass its minimum");
    }
  }
});

export type AdTemplateParsed = z.infer<typeof adTemplateSchema>;

export const adDocumentSchema = z.object({
  schema: z.literal("blockwise.ad-document"), templateId: z.string().min(1),
  sharedImageValues: z.record(z.string().min(1)), sharedTextValues: z.record(z.string()),
  feedCropOverrides: z.record(rectSchema), storyCropOverrides: z.record(rectSchema),
  colourMode: z.enum(["template", "brand_pack", "custom"]), resolvedColourMap: z.record(z.string().min(1)),
  metaPrimaryText: z.string(), metaHeadline: z.string(), metaDescription: z.string(), metaCta: z.string(),
  destinationUrl: z.string().url().optional(),
  // Optional customer-facing display-name override (Brand Pack value is the
  // default). Omitted entirely on older documents — backward compatible.
  brandBusinessName: z.string().min(1).optional(),
  revision: z.number().int().positive(), lastRenderedAt: z.string().datetime().nullable().optional(),
}).strict();
export type AdDocumentParsed = z.infer<typeof adDocumentSchema>;
