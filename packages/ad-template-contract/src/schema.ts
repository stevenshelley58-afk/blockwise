import { z } from "zod";
const rectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict();
const fontSchema = z.object({ file: z.string().min(1) }).strict();
const layerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plate"), layerId: z.string().min(1), colourRole: z.enum(["background","primary","secondary","accent","mainText","inverseText"]), assetKey: z.string().min(1).optional(), geometry: rectSchema, protected: z.boolean() }).strict(),
  z.object({ type: z.literal("image_slot"), layerId: z.string().min(1), inputKey: z.string().min(1), geometry: rectSchema, mask: z.enum(["rounded_rect", "circle", "none"]), minSourceWidth: z.number().int().positive(), minSourceHeight: z.number().int().positive(), defaultCrop: rectSchema, allowedPlacementOverrides: z.array(z.enum(["crop", "position"])) }).strict(),
  z.object({ type: z.literal("overlay_patch"), layerId: z.string().min(1), geometry: rectSchema, colourRole: z.enum(["background","primary","secondary","accent","mainText","inverseText"]), opacity: z.number().min(0).max(1), assetKey: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal("text"), layerId: z.string().min(1), inputKey: z.string().min(1), font: fontSchema, fontSize: z.number().positive(), lineHeight: z.number().positive(), tracking: z.number(), alignment: z.enum(["left", "center", "right"]), maxCharacters: z.number().int().positive(), maxLines: z.number().int().positive(), colourRole: z.enum(["background","primary","secondary","accent","mainText","inverseText"]), overflowBehaviour: z.enum(["refuse", "truncate", "scale_down"]), geometry: rectSchema }).strict(),
  z.object({ type: z.literal("logo"), layerId: z.string().min(1), inputKey: z.string().min(1), geometry: rectSchema }).strict(),
  z.object({ type: z.literal("vector"), layerId: z.string().min(1), geometry: rectSchema, shape: z.enum(["rect", "rounded", "circle", "line", "pill", "notched", "wave", "ring"]), colourRole: z.enum(["background","primary","secondary","accent","mainText","inverseText"]), opacity: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal("icon"), layerId: z.string().min(1), geometry: rectSchema, icon: z.string().min(1), colourRole: z.enum(["background","primary","secondary","accent","mainText","inverseText"]) }).strict(),
]);
const layoutSchema = z.object({ placement: z.enum(["feed", "story"]), layers: z.array(layerSchema).min(1).max(256), safeZones: z.array(rectSchema).max(32) }).strict().superRefine((layout, ctx) => {
  const [width, height] = layout.placement === "feed" ? [1080, 1350] : [1080, 1920];
  for (const layer of layout.layers) {
    const geometry = layer.geometry;
    if (geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.width > width || geometry.y + geometry.height > height) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "layer geometry is outside placement bounds" });
  }
});
const imageInputSchema = z.object({ key: z.string().min(1), label: z.string().min(1), required: z.boolean().optional(), acceptedTypes: z.array(z.string().min(1)).min(1), defaultAssetKey: z.string().min(1).optional() }).strict();
const textInputSchema = z.object({ key: z.string().min(1), label: z.string().min(1), placeholder: z.string(), maxLength: z.number().int().positive() }).strict();
const gallerySampleSchema = z.object({ assetKey: z.string().min(1).optional(), placement: z.enum(["feed", "story"]), purpose: z.string().min(1) }).strict();
const metadataSchema = z.object({
  title: z.string().min(1), description: z.string(),
  gallerySamples: z.object({ feed: gallerySampleSchema.optional(), story: gallerySampleSchema.optional() }).strict(),
  metaCopyDefaults: z.object({ primaryText: z.array(z.string()), headlines: z.array(z.string()), descriptions: z.array(z.string()), cta: z.string() }).strict(),
  aiWritingGuidance: z.object({ summary: z.string(), fields: z.record(z.string()) }).strict(),
  publishRequirements: z.object({
    objective: z.string().min(1), specialAdCategory: z.string().nullable(),
    instantForm: z.object({ required: z.boolean(), dependency: z.string().nullable(), defaults: z.record(z.string()).optional() }).strict(),
    destination: z.object({ required: z.boolean(), kind: z.enum(["website", "instant_form", "none"]), dependency: z.string().nullable() }).strict(),
    requiredCtaTypes: z.array(z.string()).default([]),
  }).strict(),
  replacementAssets: z.array(z.object({ inputKey: z.string().min(1), assetKey: z.string().min(1), purpose: z.string().optional() }).strict()),
  realAssetRefs: z.array(z.object({ inputKey: z.string().min(1), kind: z.string().min(1), required: z.boolean() }).strict()),
}).strict();
export const adTemplateSchema = z.object({
  schema: z.literal("blockwise.ad-template"), templateId: z.string().min(1).max(160), createdAt: z.string().datetime(),
  feedLayout: layoutSchema.refine((value) => value.placement === "feed"), storyLayout: layoutSchema.refine((value) => value.placement === "story"),
  imageInputs: z.array(imageInputSchema), textInputs: z.array(textInputSchema),
  semanticColours: z.object({ background: z.string().min(1), primary: z.string().min(1), secondary: z.string().min(1), accent: z.string().min(1), mainText: z.string().min(1), inverseText: z.string().min(1) }).strict(),
  assets: z.record(z.object({ fileName: z.string().min(1), mimeType: z.string().min(1) }).strict()),
  fonts: z.array(fontSchema), metadata: metadataSchema,
}).strict().superRefine((template, ctx) => { const inputKeys = new Set([...template.imageInputs.map((input) => input.key), ...template.textInputs.map((input) => input.key)]); const assetKeys = new Set(Object.keys(template.assets)); const fontFiles = new Set(template.fonts.map((font) => font.file)); for (const input of template.imageInputs) if (input.defaultAssetKey && !assetKeys.has(input.defaultAssetKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "image default asset is not declared" }); for (const layout of [template.feedLayout, template.storyLayout]) { const ids = new Set<string>(); for (const layer of layout.layers) { if (ids.has(layer.layerId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "layer IDs must be unique" }); ids.add(layer.layerId); if ("inputKey" in layer && !inputKeys.has(layer.inputKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "layer input is not declared" }); if ("assetKey" in layer && layer.assetKey && !assetKeys.has(layer.assetKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "layer asset is not declared" }); if (layer.type === "text" && !fontFiles.has(layer.font.file)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "text font is not declared" }); } for (const zone of layout.safeZones) if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > (layout.placement === "feed" ? 1080 : 1080) || zone.y + zone.height > (layout.placement === "feed" ? 1350 : 1920)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safe zone is outside placement bounds" }); } });
export type AdTemplateParsed = z.infer<typeof adTemplateSchema>;
export const adDocumentSchema = z.object({
  schema: z.literal("blockwise.ad-document"), templateId: z.string().min(1),
  sharedImageValues: z.record(z.string().min(1)), sharedTextValues: z.record(z.string()),
  feedCropOverrides: z.record(rectSchema), storyCropOverrides: z.record(rectSchema),
  colourMode: z.enum(["template", "brand_pack"]), resolvedColourMap: z.record(z.string().min(1)),
  metaPrimaryText: z.string(), metaHeadline: z.string(), metaDescription: z.string(), metaCta: z.string(),
  revision: z.number().int().positive(), lastRenderedAt: z.string().datetime().nullable().optional(),
}).strict();
export type AdDocumentParsed = z.infer<typeof adDocumentSchema>;
