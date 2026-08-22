// Advantage+ creative feature keys known as of Graph v26 (plan Appendix A).
// Single source of truth: meta-execution re-exports these for the publish
// payload, the ingestion CLI mirrors them (lockstep test), and the publish
// panel lists them in "What will be sent".

export const META_CREATIVE_FEATURE_KEYS = [
  "adapt_to_placement",
  "image_touchups",
  "image_templates",
  "inline_comment",
  "enhance_cta",
  "text_optimizations",
  "image_animation",
  "image_background_gen",
  "video_auto_crop",
  "translate_voiceover",
  "text_translation",
  "media_type_automation",
  "product_extensions",
] as const;

export type MetaCreativeFeatureEnrollment = Record<string, "OPT_IN" | "OPT_OUT">;

/** Default: every enhancement explicitly OPT_OUT — preview = what Meta renders. */
export function buildDefaultMetaCreativeFeatures(): MetaCreativeFeatureEnrollment {
  return Object.fromEntries(META_CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT" as const]));
}
