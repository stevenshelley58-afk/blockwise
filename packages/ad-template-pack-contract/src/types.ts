// ---------------------------------------------------------------------------
// TemplatePack shared constants — minimal surface restored after the legacy
// ad-pack retirement (the full legacy types.ts stays deleted; the contract
// lives in schema.ts as zod schemas + inferred types).
// ---------------------------------------------------------------------------

/** Semantic colour roles — resolved from template or Brand Pack at render time. */
export const COLOUR_ROLES = [
  "background",
  "primary",
  "secondary",
  "accent",
  "mainText",
  "inverseText",
] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];

/** Supported layer types in a layout's ordered tree. */
export const LAYER_TYPES = [
  "plate",
  "image_slot",
  "overlay_patch",
  "text",
  "logo",
  "vector",
  "icon",
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

/** Render placements. */
export const PLACEMENTS = ["feed", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];
