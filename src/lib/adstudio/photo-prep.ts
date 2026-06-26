import { z } from "zod";

import type { AdStudioTemplate } from "./templates.ts";
import { resolveTemplateDesignForFormat } from "./template-design.ts";
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
  template: Pick<AdStudioTemplate, "creativeSkeleton" | "designs" | "id" | "templateKey" | "name">;
  format: AdStudioFormat;
}): TemplateRenderFrame {
  const canvas = getCanvasSize(input.format);
  const design = resolveTemplateDesignForFormat(input.template, input.format);
  if (design) {
    const imageSlots = design.layers
      .filter((layer) => layer.type === "image_slot")
      .map((layer) => ({
        id: layer.id,
        role: layer.role,
        x: layer.rect.x,
        y: layer.rect.y,
        width: layer.rect.w,
        height: layer.rect.h,
        promptHint: `${input.template.name ?? design.templateId} ${layer.role} image slot`,
      }));
    const copySafeZones = design.layers
      .filter((layer) => layer.type === "text" || layer.type === "cta_button")
      .map((layer, index) => ({ layer, index, priority: copySafeZonePriority(layer) }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .slice(0, 8)
      .map((layer) => ({
        id: layer.layer.id,
        x: layer.layer.rect.x,
        y: layer.layer.rect.y,
        width: layer.layer.rect.w,
        height: layer.layer.rect.h,
      }));

    return templateRenderFrameSchema.parse({
      format: input.format,
      canvas: {
        widthPx: design.canvas.w,
        heightPx: design.canvas.h,
      },
      imageSlots,
      copySafeZones,
      lockedLayout: true,
    });
  }

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

function copySafeZonePriority(layer: { type: string; fill?: string; label?: string; slot?: string }): number {
  if (layer.type === "cta_button") return 0;
  if (layer.fill === "ai_copy") return 1;
  if (layer.fill === "brand") return 2;
  return 3;
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
 * The chokepoint's method decision for one slot-format. Pure and deterministic:
 *  - unknown source dimensions => model_reframe (let the model recompose safely).
 *  - aspect within tolerance => deterministic_smart_crop (no paid model call;
 *    the renderer slice-crops the source).
 *  - large aspect mismatch => model_extend (cropping would lose too much).
 *  - otherwise => model_reframe.
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

export function buildPreparePhotoForTemplateFramePrompt(context: PhotoPrepContext): string {
  const slot = selectedImageSlot(context);
  return [
    "Prepare this real-estate photo for a locked ad template frame.",
    "",
    "You are editing only the photo asset that will sit inside the template image slot.",
    "Do not create a finished advertisement.",
    "Do not add text.",
    "Do not add logos.",
    "Do not add badges.",
    "Do not add borders.",
    "Do not add buttons.",
    "Do not add icons.",
    "Do not add graphic overlays.",
    "Do not change the template layout.",
    "",
    "The final template, typography, logo, CTA, and copy will be composited after this step.",
    "",
    "Goal:",
    "Create the strongest premium real-estate photo asset for this exact frame.",
    "",
    "You may crop tighter, reframe, or extend the image edges when that produces the best result.",
    "Preserve the truth of the property.",
    "Do not invent rooms, pools, views, landscaping, architectural features, fixtures, furniture, or property condition.",
    "When extending, continue only plausible visual content from the existing image edges.",
    "",
    "Frame:",
    `- Format: ${context.frame.format}`,
    `- Output size: ${context.frame.canvas.widthPx} x ${context.frame.canvas.heightPx}`,
    `- Image slot: ${formatRect(slot)}`,
    `- Copy safe zones: ${context.frame.copySafeZones.length ? context.frame.copySafeZones.map(formatRect).join("; ") : "none"}`,
    slot.promptHint ? `- Template image hint: ${slot.promptHint}` : "",
    "",
    "Brand feel:",
    context.brand?.imageTreatment ?? "Premium, natural, clean real-estate photography.",
    context.brand?.palette?.length ? `Palette context: ${context.brand.palette.join(", ")}` : "",
    "",
    "Campaign:",
    context.campaign?.goal ? `- Goal: ${context.campaign.goal}` : "",
    context.campaign?.offerId ? `- Offer: ${context.campaign.offerId}` : "",
    context.campaign?.market ? `- Market: ${formatMarket(context.campaign.market)}` : "",
    context.campaign?.propertyType ? `- Property type: ${context.campaign.propertyType}` : "",
    "",
    "User brief:",
    context.brief?.trim() || "No additional brief.",
    "",
    "Composition guidance:",
    "Keep the most commercially useful real-estate visual subject strong.",
    "Avoid awkward empty areas, accidental letterboxing, distorted geometry, warped walls, stretched windows, broken rooflines, fake reflections, or unnatural skies.",
    "Where copy safe zones overlap the image, keep those areas visually calm and lower contrast when possible.",
    "",
    "Return only the edited photo asset.",
  ].filter(Boolean).join("\n");
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

function formatRect(rect: AdStudioRect & { id?: string }): string {
  const prefix = rect.id ? `${rect.id} ` : "";
  return `${prefix}{x:${rect.x}, y:${rect.y}, width:${rect.width}, height:${rect.height}}`;
}

function formatMarket(market: NonNullable<PhotoPrepContext["campaign"]>["market"]): string {
  if (typeof market === "string") return market;
  return [market?.suburb, market?.city, market?.state].filter(Boolean).join(", ");
}
