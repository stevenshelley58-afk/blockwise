import { z } from "zod";

import type { AdStudioFormat } from "./types.ts";

const normalizedNumberSchema = z.number().min(0).max(1);

const rectSchema = z
  .object({
    x: normalizedNumberSchema,
    y: normalizedNumberSchema,
    w: normalizedNumberSchema,
    h: normalizedNumberSchema,
  })
  .strict()
  .refine((rect) => rect.x + rect.w <= 1, "rect exceeds canvas width")
  .refine((rect) => rect.y + rect.h <= 1, "rect exceeds canvas height");

const textSlotSchema = z.enum([
  "eyebrow",
  "headline",
  "subhead",
  "body",
  "cta",
  "price",
  "address",
  "stat",
  "handle",
  "phone",
]);

const textFillSchema = z.enum(["ai_copy", "brand", "static"]);
const textCopyFieldSchema = z.enum(["headline", "description", "cta", "static", "brand"]);

const baseLayerShape = {
  id: z.string().trim().min(1).max(80),
  rect: rectSchema,
};

const shapeLayerSchema = z
  .object({
    ...baseLayerShape,
    type: z.literal("shape"),
    fill: z.string().trim().min(1).max(80),
    radius: z.number().min(0).max(2000).optional(),
    opacity: z.number().min(0).max(1).optional(),
    role: z.enum(["background", "panel", "band", "scrim"]).optional(),
    locked: z.boolean().optional(),
  })
  .strict();

const textLayerSchema = z
  .object({
    ...baseLayerShape,
    type: z.literal("text"),
    slot: textSlotSchema,
    align: z.enum(["left", "center", "right"]),
    font: z.string().trim().min(1).max(80),
    size: z.number().positive().max(320),
    lineHeight: z.number().positive().max(4),
    weight: z.number().int().min(100).max(1000),
    color: z.string().trim().min(1).max(80),
    letterSpacing: z.number().min(-20).max(40).optional(),
    case: z.enum(["none", "upper"]).optional(),
    maxChars: z.number().int().positive().max(500).optional(),
    maxLines: z.number().int().positive().max(8).optional(),
    editorLabel: z.string().trim().min(1).max(80).optional(),
    copyField: textCopyFieldSchema.optional(),
    guidance: z.string().trim().min(1).max(180).optional(),
    fill: textFillSchema,
    text: z.string().max(500).optional(),
  })
  .strict();

const imageSlotLayerSchema = z
  .object({
    ...baseLayerShape,
    type: z.literal("image_slot"),
    role: z.enum(["primary", "secondary", "agent_headshot"]),
    fit: z.enum(["cover", "contain", "smart"]),
    anchor: z.enum(["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"]).optional(),
    mask: z.enum(["none", "feather", "circle", "shape"]).optional(),
    clipShape: rectSchema.optional(),
    editorLabel: z.string().trim().min(1).max(80).optional(),
    guidance: z.string().trim().min(1).max(180).optional(),
    required: z.boolean().optional(),
  })
  .strict();

const logoLayerSchema = z
  .object({
    ...baseLayerShape,
    type: z.literal("logo"),
    source: z.literal("brand_kit"),
  })
  .strict();

const ctaButtonLayerSchema = z
  .object({
    ...baseLayerShape,
    type: z.literal("cta_button"),
    fill: z.string().trim().min(1).max(80),
    radius: z.number().min(0).max(2000),
    label: textSlotSchema,
    textColor: z.string().trim().min(1).max(80),
    font: z.string().trim().min(1).max(80),
    size: z.number().positive().max(160),
    maxChars: z.number().int().positive().max(80).optional(),
    maxLines: z.number().int().positive().max(3).optional(),
    editorLabel: z.string().trim().min(1).max(80).optional(),
    copyField: textCopyFieldSchema.optional(),
    guidance: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

export const templateLayerSchema = z.discriminatedUnion("type", [
  shapeLayerSchema,
  textLayerSchema,
  imageSlotLayerSchema,
  logoLayerSchema,
  ctaButtonLayerSchema,
]);

export const templateDesignSchema = z
  .object({
    templateId: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
    format: z.enum(["9:16", "4:5", "1:1", "1.91:1"]),
    canvas: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict(),
    palette: z.array(z.string().trim().min(1).max(80)).min(1).max(16),
    fonts: z.array(z.string().trim().min(1).max(80)).min(1).max(16),
    layers: z.array(templateLayerSchema).min(1).max(80),
  })
  .strict();

export type TemplateRect = z.infer<typeof rectSchema>;
export type TextSlot = z.infer<typeof textSlotSchema>;
export type TextFill = z.infer<typeof textFillSchema>;
export type TextCopyField = z.infer<typeof textCopyFieldSchema>;
export type TemplateLayer = z.infer<typeof templateLayerSchema>;
export type TemplateDesign = z.infer<typeof templateDesignSchema>;

export type TemplateDesignSet = Partial<Record<AdStudioFormat, TemplateDesign>>;

export type BoundTemplateContent = {
  text?: Partial<Record<TextSlot, string>>;
  images?: Partial<Record<string, string>>;
};

export type TemplateDesignCarrier = {
  designs?: TemplateDesignSet;
  design?: TemplateDesign;
};

export function resolveTemplateDesignForFormat(
  template: TemplateDesignCarrier | null | undefined,
  format: AdStudioFormat,
): TemplateDesign | null {
  if (!template) return null;
  const design = template.designs?.[format] ?? (template.design?.format === format ? template.design : null);
  return design ? templateDesignSchema.parse(design) : null;
}

export function designLayerSignature(design: TemplateDesign) {
  return design.layers.map((layer, z) => ({
    z,
    id: layer.id,
    type: layer.type,
    rect: layer.rect,
    role: "role" in layer ? layer.role : undefined,
    slot: "slot" in layer ? layer.slot : undefined,
    fill: "fill" in layer ? layer.fill : undefined,
    font: "font" in layer ? layer.font : undefined,
    size: "size" in layer ? layer.size : undefined,
    lineHeight: "lineHeight" in layer ? layer.lineHeight : undefined,
    maxChars: "maxChars" in layer ? layer.maxChars : undefined,
    maxLines: "maxLines" in layer ? layer.maxLines : undefined,
    editorLabel: "editorLabel" in layer ? layer.editorLabel : undefined,
    copyField: "copyField" in layer ? layer.copyField : undefined,
    guidance: "guidance" in layer ? layer.guidance : undefined,
    weight: "weight" in layer ? layer.weight : undefined,
    color: "color" in layer ? layer.color : undefined,
    align: "align" in layer ? layer.align : undefined,
    fit: "fit" in layer ? layer.fit : undefined,
    anchor: "anchor" in layer ? layer.anchor : undefined,
    mask: "mask" in layer ? layer.mask : undefined,
    source: "source" in layer ? layer.source : undefined,
    label: "label" in layer ? layer.label : undefined,
  }));
}
