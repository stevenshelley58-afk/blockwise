import { z } from "zod";

const normalizedNumberSchema = z.number().min(0).max(1);

const normalizedRectShape = {
  x: normalizedNumberSchema,
  y: normalizedNumberSchema,
  width: normalizedNumberSchema,
  height: normalizedNumberSchema,
};

const imageFrameSchema = z
  .object({
    ...normalizedRectShape,
    id: z.string().trim().min(1).max(80),
    role: z.enum(["primary", "secondary", "agent_headshot"]).default("primary"),
    formats: z.array(z.enum(["1:1", "4:5", "9:16", "1.91:1"])).min(1).max(4).optional(),
    prompt_hint: z.string().trim().min(1).max(240).optional(),
  })
  .strict()
  .refine((frame) => frame.x + frame.width <= 1, "image frame exceeds canvas width")
  .refine((frame) => frame.y + frame.height <= 1, "image frame exceeds canvas height");

export const creativeSkeletonArchetypeSchema = z.enum([
  "listing_hero",
  "coming_soon",
  "open_home",
  "just_sold",
  "market_stat",
  "appraisal",
  "seller_guide",
  "social_proof",
]);

const normalizedRectSchema = z
  .object({
    x: normalizedNumberSchema,
    y: normalizedNumberSchema,
    width: normalizedNumberSchema,
    height: normalizedNumberSchema,
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1, "image frame exceeds canvas width")
  .refine((rect) => rect.y + rect.height <= 1, "image frame exceeds canvas height");

// Optional per-aspect overrides; the matching format wins when present, else the
// frame's base rect is used. Partial — a template only specifies the sizes it tunes.
const imageFramePerSizeSchema = z
  .object({
    "1:1": normalizedRectSchema.optional(),
    "4:5": normalizedRectSchema.optional(),
    "9:16": normalizedRectSchema.optional(),
    "1.91:1": normalizedRectSchema.optional(),
  })
  .strict();

// Where the listing photo sits on the canvas (normalized 0..1). Absent => the
// composition/full-bleed default is used, so this stays backward compatible.
export const creativeImageFrameSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    x: normalizedNumberSchema,
    y: normalizedNumberSchema,
    width: normalizedNumberSchema,
    height: normalizedNumberSchema,
    clip: z.enum(["rect", "circle", "arch"]).optional(),
    per_size: imageFramePerSizeSchema.optional(),
  })
  .strict()
  .refine((frame) => frame.x + frame.width <= 1, "image frame exceeds canvas width")
  .refine((frame) => frame.y + frame.height <= 1, "image frame exceeds canvas height");

export const creativeSkeletonSchema = z
  .object({
    version: z.literal(1).default(1),
    archetype: creativeSkeletonArchetypeSchema,
    shot: z
      .object({
        type: z.string().trim().min(1).max(80),
        lighting: z.string().trim().min(1).max(120),
        mood: z.string().trim().min(1).max(120),
      })
      .strict(),
    composition: z
      .object({
        focal_point: z.string().trim().min(1).max(120),
        horizon: z.enum(["low", "middle", "high", "none"]),
        image_frames: z.array(imageFrameSchema).min(1).max(8).optional(),
        copy_safe_zones: z
          .array(
            z
              .object({
                id: z.string().trim().min(1).max(80),
                x: normalizedNumberSchema,
                y: normalizedNumberSchema,
                width: normalizedNumberSchema,
                height: normalizedNumberSchema,
                priority: z.enum(["primary", "secondary", "cta"]).optional(),
              })
              .strict()
              .refine((zone) => zone.x + zone.width <= 1, "copy safe zone exceeds canvas width")
              .refine((zone) => zone.y + zone.height <= 1, "copy safe zone exceeds canvas height"),
          )
          .min(1)
          .max(6),
      })
      .strict(),
    color: z
      .object({
        palette: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
        overlay: z.string().trim().min(1).max(120),
        contrast: z.enum(["low", "medium", "high"]),
      })
      .strict(),
    text_system: z
      .object({
        headline_zone: z.string().trim().min(1).max(120),
        badge: z.string().trim().min(1).max(120),
        cta_style: z.string().trim().min(1).max(120),
      })
      .strict(),
    copy: z
      .object({
        hook_style: z.string().trim().min(1).max(120),
        headline_pattern: z.string().trim().min(1).max(160),
        cta: z.string().trim().min(1).max(80),
      })
      .strict(),
    variables: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    confidence: z.number().min(0).max(100),
    // Optional photo placement spots. Absent => composition/full-bleed default
    // (backward compatible). The first frame is the primary listing photo.
    image_frames: z.array(creativeImageFrameSchema).min(1).max(6).optional(),
  })
  .strict();

export type CreativeSkeleton = z.infer<typeof creativeSkeletonSchema>;
export type CreativeSkeletonArchetype = z.infer<typeof creativeSkeletonArchetypeSchema>;
export type CreativeImageFrame = z.infer<typeof creativeImageFrameSchema>;
