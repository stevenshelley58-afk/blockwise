import { z } from "zod";

const normalizedNumberSchema = z.number().min(0).max(1);

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
  })
  .strict();

export type CreativeSkeleton = z.infer<typeof creativeSkeletonSchema>;
export type CreativeSkeletonArchetype = z.infer<typeof creativeSkeletonArchetypeSchema>;
