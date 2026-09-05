export const COLOUR_ROLES = ["background", "primary", "secondary", "accent", "mainText", "inverseText"] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];
export const LAYER_TYPES = ["plate", "image_slot", "overlay_patch", "text", "logo", "vector", "icon"] as const;
export type LayerType = (typeof LAYER_TYPES)[number];
export const SUPPORTED_ICON_NAMES = ["arrow", "check", "tick", "phone", "mail", "globe", "location"] as const;
export type SupportedIconName = (typeof SUPPORTED_ICON_NAMES)[number];
export interface Rect { x: number; y: number; width: number; height: number; }
export type SafeZone = Rect;
export type MaskType = "rounded_rect" | "circle" | "none";
export interface FontRef { file: string; }
export interface LayerShadow { colourRole: ColourRole; opacity: number; blur: number; offsetX: number; offsetY: number; }
export interface LayerStroke { colourRole: ColourRole; opacity: number; width: number; }
export interface LinearGradientFill { type: "linear_gradient"; angleDegrees: number; stops: { offset: number; colourRole: ColourRole; opacity: number }[]; }
export interface LayerEffects { rotationDegrees?: number; blendMode?: "source-over" | "multiply" | "screen" | "overlay" | "darken" | "lighten"; shadow?: LayerShadow; stroke?: LayerStroke; }
export interface LayerAppearance { effects?: LayerEffects; fill?: LinearGradientFill; cornerRadius?: number; }
export interface ImageSlotDefaults { inputKey: string; geometry: Rect; mask: MaskType; minSourceWidth: number; minSourceHeight: number; defaultCrop: Rect; allowedPlacementOverrides: ("crop" | "position")[]; }
export interface TextLayerDefaults { inputKey: string; font: FontRef; fontSize: number; sizeRatio?: number; lineHeight: number; /** Absolute inter-grapheme spacing in placement canvas pixels (-4..4). */ tracking: number; alignment: "left" | "center" | "right"; maxCharacters: number; maxLines: number; colourRole: ColourRole; overflowBehaviour: "refuse" | "truncate" | "scale_down"; }
export interface PlateLayer extends LayerAppearance { type: "plate"; layerId: string; colourRole: ColourRole; assetKey?: string; geometry: Rect; protected: boolean; }
export interface ImageSlotLayer extends ImageSlotDefaults, Omit<LayerAppearance, "fill"> { type: "image_slot"; layerId: string; opacity?: number; }
export interface OverlayPatchLayer extends LayerAppearance { type: "overlay_patch"; layerId: string; geometry: Rect; colourRole: ColourRole; opacity: number; assetKey?: string; }
export interface TextLayer extends TextLayerDefaults, Omit<LayerAppearance, "fill" | "cornerRadius"> { type: "text"; layerId: string; geometry: Rect; fontFamily?: string; fontWeight?: number; italic?: boolean; case?: "upper" | "lower" | "none"; opacity?: number; }
export interface LogoLayer extends Omit<LayerAppearance, "fill"> { type: "logo"; layerId: string; geometry: Rect; inputKey: string; opacity?: number; }
export interface VectorLayer extends LayerAppearance { type: "vector"; layerId: string; geometry: Rect; shape: "rect" | "rounded" | "circle" | "line" | "pill" | "notched" | "wave" | "ring"; colourRole: ColourRole; opacity: number; }
export interface IconLayer extends Omit<LayerAppearance, "fill" | "cornerRadius"> { type: "icon"; layerId: string; geometry: Rect; icon: SupportedIconName; colourRole: ColourRole; opacity?: number; }
export type LayoutLayer = PlateLayer | ImageSlotLayer | OverlayPatchLayer | TextLayer | LogoLayer | VectorLayer | IconLayer;
export const PLACEMENTS = ["feed", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const PLACEMENT_DIMENSIONS: Record<string, { width: number; height: number }> = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } };
/** Native-canvas readability floor shared by contract validation and rendering. */
export const MINIMUM_TEXT_SIZE_PX: Record<Placement, number> = { feed: 24, story: 32 };
/** Multi-line text needs at least one full font-size of baseline separation. */
export const MINIMUM_MULTILINE_LINE_HEIGHT = 1;
/** A line shorter than this resolves to a dot rather than a useful divider. */
export const MINIMUM_VECTOR_LINE_LENGTH_PX = 8;
export interface Layout { placement: Placement; layers: LayoutLayer[]; safeZones: SafeZone[]; }
export interface ImageInput { key: string; label: string; required?: boolean; acceptedTypes: string[]; defaultAssetKey?: string; }
export interface TextInput { key: string; label: string; placeholder: string; maxLength: number; }
export interface GallerySample { assetKey?: string; placement: Placement; purpose: string; }
export interface MetaCopyDefaults { primaryText: string[]; headlines: string[]; descriptions: string[]; cta: string; }
export interface AiWritingGuidance { summary: string; fields: Record<string, string>; }
export interface InstantFormQuestion { key: string; label: string; type: "short_answer" | "email" | "phone" | "multiple_choice"; required: boolean; options?: string[]; }
export interface InstantFormDefaults { formName?: string; introHeadline?: string; introBody?: string; questions?: InstantFormQuestion[]; privacyPolicyUrl?: string; disclaimer?: string; thankYouHeadline?: string; thankYouBody?: string; thankYouAction?: "visit_website" | "download" | "call_business" | "none"; thankYouUrl?: string; }
export interface OfferRequirement { name: string; promise: string | null; terms: string[]; eligibility: string | null; expiresAt: string | null; }
export interface ClaimRequirement { text: string; kind: "factual" | "testimonial" | "guarantee" | "performance"; evidenceRequired: boolean; evidenceReference: string | null; qualifier: string | null; disclaimer: string | null; }
export interface FulfilmentRequirement { required: boolean; dependency: string | null; deliveryMethod?: "website" | "email" | "download" | "manual"; deliveryUrl?: string | null; owner?: string | null; }
export interface PublishRequirements { objective: string; specialAdCategory: string | null; instantForm: { required: boolean; dependency: string | null; defaults?: InstantFormDefaults }; destination: { required: boolean; kind: "website" | "instant_form" | "none"; dependency: string | null }; fulfilment?: FulfilmentRequirement; offer?: OfferRequirement | null; claims?: ClaimRequirement[]; requiredCtaTypes: string[]; }
export interface GenerationReview { process: "exact-clone"; sourcePlacement: Placement; targetPlacement: Placement; likenessThreshold: number; comparator: { overall: number; geometry: number; colourEffects: number; compositionCrop: number; typography: number; decision: "revise" | "ready" }; finalReviewers: { id: string; route: string; overall: number; minimum: number; decision: "pass" | "fail" }[]; warnings: string[]; fontSubstitution: null | { source: string; used: string; reason: string }; }
export interface ReplacementAsset { inputKey: string; assetKey: string; purpose?: string; }
export interface RealAssetRef { inputKey: string; kind: string; required: boolean; }
export interface TemplateMetadata { title: string; description: string; gallerySamples: { feed?: GallerySample; story?: GallerySample }; metaCopyDefaults: MetaCopyDefaults; aiWritingGuidance: AiWritingGuidance; publishRequirements: PublishRequirements; replacementAssets: ReplacementAsset[]; realAssetRefs: RealAssetRef[]; generationReview?: GenerationReview; }
export interface AdTemplate { schema: "blockwise.ad-template"; templateId: string; createdAt: string; feedLayout: Layout; storyLayout: Layout; imageInputs: ImageInput[]; textInputs: TextInput[]; semanticColours: Record<ColourRole, string>; assets: Record<string, { fileName: string; mimeType: string }>; fonts: FontRef[]; metadata: TemplateMetadata; }
export interface AdDocument { schema: "blockwise.ad-document"; templateId: string; sharedImageValues: Record<string, string>; sharedTextValues: Record<string, string>; feedCropOverrides: Record<string, Rect>; storyCropOverrides: Record<string, Rect>; colourMode: "template" | "brand_pack" | "custom"; resolvedColourMap: Record<string, string>; metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string; destinationUrl?: string; brandBusinessName?: string; revision: number; lastRenderedAt?: string | null; }
