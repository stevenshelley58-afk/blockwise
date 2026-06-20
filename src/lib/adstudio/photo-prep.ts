import { z } from "zod";

import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioFormat, AdStudioGoal } from "./types.ts";
import { getCanvasSize } from "./renderer.ts";

const normalizedNumberSchema = z.number().min(0).max(1);

const rectShape = {
  x: normalizedNumberSchema,
  y: normalizedNumberSchema,
  width: normalizedNumberSchema,
  height: normalizedNumberSchema,
};

export const adStudioRectSchema = z
  .object(rectShape)
  .strict()
  .refine((rect) => rect.x + rect.width <= 1, "rect exceeds canvas width")
  .refine((rect) => rect.y + rect.height <= 1, "rect exceeds canvas height");

export const templateImageSlotSchema = z
  .object({
    ...rectShape,
    id: z.string().trim().min(1).max(80),
    role: z.enum(["primary", "secondary", "agent_headshot"]).default("primary"),
    promptHint: z.string().trim().min(1).max(240).optional(),
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1, "image slot exceeds canvas width")
  .refine((rect) => rect.y + rect.height <= 1, "image slot exceeds canvas height");

const copySafeZoneSchema = z
  .object({
    ...rectShape,
    id: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1, "copy safe zone exceeds canvas width")
  .refine((rect) => rect.y + rect.height <= 1, "copy safe zone exceeds canvas height");

export const templateRenderFrameSchema = z
  .object({
    format: z.enum(["9:16", "4:5", "1:1", "1.91:1"]),
    canvas: z.object({ widthPx: z.number().int().positive(), heightPx: z.number().int().positive() }).strict(),
    imageSlots: z.array(templateImageSlotSchema).min(1).max(8),
    copySafeZones: z.array(copySafeZoneSchema).max(8),
    lockedLayout: z.literal(true),
  })
  .strict();

export type AdStudioRect = z.infer<typeof adStudioRectSchema>;
export type TemplateImageSlot = z.infer<typeof templateImageSlotSchema>;
export type TemplateRenderFrame = z.infer<typeof templateRenderFrameSchema>;

export type PhotoPrepMethod =
  | "deterministic_smart_crop"
  | "model_reframe"
  | "model_extend"
  | "fallback_smart_crop"
  | "legacy_imported";

export type PhotoPrepContext = {
  workspaceId: string;
  imageHash: string;
  sourceImageRef: string;
  sourceImage?: {
    naturalWidth?: number;
    naturalHeight?: number;
    focalHint?: { x: number; y: number };
  };
  template: {
    key: string;
    version: number;
    name?: string;
    archetype?: string;
  };
  frame: TemplateRenderFrame;
  imageSlotId: string;
  campaign?: {
    goal?: AdStudioGoal | string;
    offerId?: string;
    market?: { suburb?: string; city?: string; state?: string } | string;
    propertyType?: string;
  };
  brand?: {
    palette?: string[];
    imageTreatment?: string;
    voice?: string;
  };
  brief?: string;
  promptVersion?: number;
  modelProfileVersion?: number;
};

export type PreparedPhotoAsset = {
  assetUrl: string;
  widthPx: number;
  heightPx: number;
  method: PhotoPrepMethod;
  templateKey: string;
  templateVersion: number;
  frameId: string;
  format: AdStudioFormat;
  promptVersion?: number;
  modelProfileVersion?: number;
  qaStatus: "pending" | "passed" | "failed";
};

export function buildTemplateRenderFrame(input: {
  template: Pick<AdStudioTemplate, "creativeSkeleton" | "id" | "templateKey" | "name">;
  format: AdStudioFormat;
}): TemplateRenderFrame {
  const canvas = getCanvasSize(input.format);
  const skeleton = input.template.creativeSkeleton;
  const explicitSlots = (skeleton?.composition.image_frames ?? [])
    .filter((frame) => !frame.formats || frame.formats.includes(input.format))
    .map((frame) => ({
      id: frame.id,
      role: frame.role,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      promptHint: frame.prompt_hint,
    }));

  return templateRenderFrameSchema.parse({
    format: input.format,
    canvas: {
      widthPx: canvas.width,
      heightPx: canvas.height,
    },
    imageSlots: explicitSlots.length > 0 ? explicitSlots : [fallbackImageSlot(input.template)],
    copySafeZones: (skeleton?.composition.copy_safe_zones ?? []).map((zone) => ({
      id: zone.id,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    })),
    lockedLayout: true,
  });
}

export function buildPhotoPrepCacheKey(context: PhotoPrepContext): string {
  return [
    "adstudio-photo-prep-v1",
    context.workspaceId,
    context.imageHash,
    context.template.key,
    context.template.version,
    context.imageSlotId,
    context.frame.format,
    context.promptVersion ?? "prompt-live",
    context.modelProfileVersion ?? "model-live",
  ].map((part) => encodeURIComponent(String(part))).join(":");
}

export function selectedImageSlot(context: Pick<PhotoPrepContext, "frame" | "imageSlotId">): TemplateImageSlot {
  const slot = context.frame.imageSlots.find((candidate) => candidate.id === context.imageSlotId);
  if (!slot) {
    throw new Error(`Template image slot not found: ${context.imageSlotId}`);
  }
  return slot;
}

// How much the source and slot aspect ratios may differ before the model is
// needed. Within tolerance a deterministic slice-crop is faithful and free.
const PHOTO_PREP_ASPECT_MATCH_TOLERANCE = 0.04;
// Beyond this disparity, cropping to cover would discard too much of the photo,
// so we extend (outpaint) rather than crop.
const PHOTO_PREP_EXTEND_DISPARITY = 0.45;

export type PhotoPrepDecisionMethod = Extract<
  PhotoPrepMethod,
  "deterministic_smart_crop" | "model_reframe" | "model_extend"
>;

/**
 * The chokepoint's method decision for one slot×format. Pure and deterministic:
 *  - unknown source dimensions => model_reframe (let the model recompose safely).
 *  - aspect within tolerance => deterministic_smart_crop (no paid model call;
 *    the renderer slice-crops the source).
 *  - large aspect mismatch => model_extend (cropping would lose too much).
 *  - otherwise => model_reframe.
 * The model paths still enforce truth preservation via the registry framing
 * prompt; this only decides whether to spend a model call and which intent.
 */
export function selectPhotoPrepMethod(
  context: Pick<PhotoPrepContext, "frame" | "imageSlotId" | "sourceImage">,
): PhotoPrepDecisionMethod {
  const slot = selectedImageSlot(context);
  const sourceWidth = context.sourceImage?.naturalWidth;
  const sourceHeight = context.sourceImage?.naturalHeight;
  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) {
    return "model_reframe";
  }

  const slotWidthPx = slot.width * context.frame.canvas.widthPx;
  const slotHeightPx = slot.height * context.frame.canvas.heightPx;
  if (slotWidthPx <= 0 || slotHeightPx <= 0) return "model_reframe";

  const sourceAspect = sourceWidth / sourceHeight;
  const slotAspect = slotWidthPx / slotHeightPx;
  const disparity = Math.abs(sourceAspect - slotAspect) / Math.max(sourceAspect, slotAspect);

  if (disparity <= PHOTO_PREP_ASPECT_MATCH_TOLERANCE) return "deterministic_smart_crop";
  if (disparity >= PHOTO_PREP_EXTEND_DISPARITY) return "model_extend";
  return "model_reframe";
}

export function deterministicPreparedPhotoAsset(input: {
  context: PhotoPrepContext;
  assetUrl: string;
  method?: Extract<PhotoPrepMethod, "deterministic_smart_crop" | "fallback_smart_crop">;
}): PreparedPhotoAsset {
  return {
    assetUrl: input.assetUrl,
    widthPx: input.context.frame.canvas.widthPx,
    heightPx: input.context.frame.canvas.heightPx,
    method: input.method ?? "deterministic_smart_crop",
    templateKey: input.context.template.key,
    templateVersion: input.context.template.version,
    frameId: input.context.imageSlotId,
    format: input.context.frame.format,
    promptVersion: input.context.promptVersion,
    modelProfileVersion: input.context.modelProfileVersion,
    qaStatus: "pending",
  };
}

function fallbackImageSlot(template: Pick<AdStudioTemplate, "creativeSkeleton" | "name">): TemplateImageSlot {
  const skeleton = template.creativeSkeleton;
  const promptHint = skeleton
    ? [
        skeleton.shot.type,
        `focal point: ${skeleton.composition.focal_point}`,
        "full-bleed template photo",
        "keep copy-safe areas calm",
      ].join("; ")
    : `${template.name ?? "Template"} full-bleed customer photo.`;

  return templateImageSlotSchema.parse({
    id: "primary_photo",
    role: "primary",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    promptHint,
  });
}

