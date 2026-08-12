// ---------------------------------------------------------------------------
// TemplatePack v1 — frozen contract (Phase 2 gate)
// No field additions without a new schema version.
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
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SafeZone = Rect;

// ---------------------------------------------------------------------------
// Image slot
// ---------------------------------------------------------------------------

export type MaskType = "rounded_rect" | "circle" | "none";

export interface ImageSlotDefaults {
  /** Input key shared across Feed and Story. */
  inputKey: string;
  /** Normalized geometry in the layout's coordinate space. */
  geometry: Rect;
  mask: MaskType;
  /** Minimum accepted source dimensions (pixels). */
  minSourceWidth: number;
  minSourceHeight: number;
  /** Default crop normalized to [0,1]. */
  defaultCrop: Rect;
  /** Placement-specific overrides allowed (e.g. different crop per placement). */
  allowedPlacementOverrides: ("crop" | "position")[];
}

// ---------------------------------------------------------------------------
// Text layer
// ---------------------------------------------------------------------------

export interface FontRef {
  /** Font file name (e.g. "Inter-Bold.woff2"). */
  file: string;
  /** SHA-256 hash of the font file bytes. */
  sha256: string;
}

export interface TextLayerDefaults {
  /** Input key shared across Feed and Story. */
  inputKey: string;
  font: FontRef;
  fontSize: number;
  lineHeight: number;
  /** Letter-spacing in em units. */
  tracking: number;
  alignment: "left" | "center" | "right";
  /** Maximum characters before overflow refusal. */
  maxCharacters: number;
  /** Maximum lines before overflow refusal. */
  maxLines: number;
  colourRole: ColourRole;
  /** Behaviour when text exceeds bounds. */
  overflowBehaviour: "refuse" | "truncate" | "scale_down";
}

// ---------------------------------------------------------------------------
// Layer tree
// ---------------------------------------------------------------------------

export interface PlateLayer {
  type: "plate";
  /** Layer id unique within the layout. */
  layerId: string;
  /** Background colour role. */
  colourRole: ColourRole;
  geometry: Rect;
  /** True if this region must be inpaint-masked during content replacement. */
  protected: boolean;
}

export interface ImageSlotLayer extends ImageSlotDefaults {
  type: "image_slot";
  layerId: string;
}

export interface OverlayPatchLayer {
  type: "overlay_patch";
  layerId: string;
  geometry: Rect;
  /** Colour role for the overlay tint. */
  colourRole: ColourRole;
  opacity: number;
}

export interface TextLayer extends TextLayerDefaults {
  type: "text";
  layerId: string;
}

export interface LogoLayer {
  type: "logo";
  layerId: string;
  geometry: Rect;
  /** Declared logo input key — must exist in inputs. */
  inputKey: string;
}

export type LayoutLayer =
  | PlateLayer
  | ImageSlotLayer
  | OverlayPatchLayer
  | TextLayer
  | LogoLayer;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const PLACEMENTS = ["feed", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export interface Layout {
  placement: Placement;
  /** Ordered layer tree — bottom to top. */
  layers: LayoutLayer[];
  /** Safe zones for text and critical content. */
  safeZones: SafeZone[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ImageInput {
  key: string;
  label: string;
  /** Accepted MIME types. */
  acceptedTypes: string[];
}

export interface TextInput {
  key: string;
  label: string;
  /** Placeholder shown in the editor. */
  placeholder: string;
  /** Maximum characters across all placements. */
  maxLength: number;
}

// ---------------------------------------------------------------------------
// AI classification
// ---------------------------------------------------------------------------

export interface Classification {
  /** AI ad-radar classification label. */
  label: string;
  /** Classification model version. */
  modelVersion: string;
  /** Classification confidence [0,1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// TemplatePack (the signed, immutable envelope)
// ---------------------------------------------------------------------------

export interface TemplatePack {
  schema: "blockwise.template-pack/v1";
  templateId: string;
  version: number;
  packId: string;
  createdAt: string; // ISO 8601
  builderVersion: string;
  rendererVersion: string;
  classification: Classification;
  /** SHA-256 of the canonical JSON before signing. */
  manifestSha256: string;
  /** Ed25519 signature over manifestSha256. */
  signature: string;
  feedLayout: Layout;
  storyLayout: Layout;
  /** Declared customer image inputs. */
  imageInputs: ImageInput[];
  /** Declared customer text inputs. */
  textInputs: TextInput[];
  /** Semantic colour palette — resolved at render time. */
  semanticColours: Record<ColourRole, string>;
  /** Asset hashes keyed by asset id. */
  assets: Record<string, { fileName: string; sha256: string; mimeType: string }>;
  /** Font references used by text layers. */
  fonts: FontRef[];
  /** Pre-rendered previews for the gallery — one per placement. */
  safePreviews: Record<Placement, { sha256: string }>;
  /** Automated QA evidence. */
  qaEvidence: {
    feedPassed: boolean;
    storyPassed: boolean;
    reviewerVersions: string[];
    stressFixtureResults: Record<string, "pass" | "fail">;
  };
}

// ---------------------------------------------------------------------------
// Forbidden fields (compile-time guard via type exclusion)
// A valid pack MUST NOT contain any of the following at runtime.
// ---------------------------------------------------------------------------

export type ForbiddenPackFields =
  | "executableCode"
  | "html"
  | "externalAssetUrls"
  | "dataUrls"
  | "privateSourceImages"
  | "promptHistories"
  | "credentials"
  | "rejectedCandidates"
  | "humanReviewFields"
  | "missingPlacementLayouts";
