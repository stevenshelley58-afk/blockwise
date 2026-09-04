export const COLOUR_ROLES = ["background", "primary", "secondary", "accent", "mainText", "inverseText"] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];
export const LAYER_TYPES = ["plate", "image_slot", "overlay_patch", "text", "logo", "vector", "icon"] as const;
export type LayerType = (typeof LAYER_TYPES)[number];
export interface Rect { x: number; y: number; width: number; height: number; }
export type SafeZone = Rect;
export type MaskType = "rounded_rect" | "circle" | "none";
export interface FontRef { file: string; }
export interface ImageSlotDefaults { inputKey: string; geometry: Rect; mask: MaskType; minSourceWidth: number; minSourceHeight: number; defaultCrop: Rect; allowedPlacementOverrides: ("crop" | "position")[]; }
export interface TextLayerDefaults { inputKey: string; font: FontRef; fontSize: number; sizeRatio?: number; lineHeight: number; /** Absolute inter-grapheme spacing in placement canvas pixels (-4..4). */ tracking: number; alignment: "left" | "center" | "right"; maxCharacters: number; maxLines: number; colourRole: ColourRole; overflowBehaviour: "refuse" | "truncate" | "scale_down"; }
export interface PlateLayer { type: "plate"; layerId: string; colourRole: ColourRole; assetKey?: string; geometry: Rect; protected: boolean; }
export interface ImageSlotLayer extends ImageSlotDefaults { type: "image_slot"; layerId: string; }
export interface OverlayPatchLayer { type: "overlay_patch"; layerId: string; geometry: Rect; colourRole: ColourRole; opacity: number; assetKey?: string; }
export interface TextLayer extends TextLayerDefaults { type: "text"; layerId: string; geometry: Rect; }
export interface LogoLayer { type: "logo"; layerId: string; geometry: Rect; inputKey: string; }
export interface VectorLayer { type: "vector"; layerId: string; geometry: Rect; shape: "rect" | "rounded" | "circle" | "line" | "pill" | "notched" | "wave" | "ring"; colourRole: ColourRole; opacity: number; }
export interface IconLayer { type: "icon"; layerId: string; geometry: Rect; icon: string; colourRole: ColourRole; }
export type LayoutLayer = PlateLayer | ImageSlotLayer | OverlayPatchLayer | TextLayer | LogoLayer | VectorLayer | IconLayer;
export const PLACEMENTS = ["feed", "story"] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const PLACEMENT_DIMENSIONS: Record<string, { width: number; height: number }> = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } };
/** Native-canvas readability floor shared by contract validation and rendering. */
export const MINIMUM_TEXT_SIZE_PX: Record<Placement, number> = { feed: 24, story: 32 };
/** Multi-line text needs at least one full font-size of baseline separation. */
export const MINIMUM_MULTILINE_LINE_HEIGHT = 1;
export interface Layout { placement: Placement; layers: LayoutLayer[]; safeZones: SafeZone[]; }
export interface ImageInput { key: string; label: string; required?: boolean; acceptedTypes: string[]; defaultAssetKey?: string; }
export interface TextInput { key: string; label: string; placeholder: string; maxLength: number; }
export interface GallerySample { assetKey?: string; placement: Placement; purpose: string; }
export interface MetaCopyDefaults { primaryText: string[]; headlines: string[]; descriptions: string[]; cta: string; }
export interface AiWritingGuidance { summary: string; fields: Record<string, string>; }
export interface PublishRequirements { objective: string; specialAdCategory: string | null; instantForm: { required: boolean; dependency: string | null; defaults?: Record<string, string> }; destination: { required: boolean; kind: "website" | "instant_form" | "none"; dependency: string | null }; fulfilment?: { required: boolean; dependency: string | null }; requiredCtaTypes: string[]; }
export interface ReplacementAsset { inputKey: string; assetKey: string; purpose?: string; }
export interface RealAssetRef { inputKey: string; kind: string; required: boolean; }
export interface TemplateMetadata { title: string; description: string; gallerySamples: { feed?: GallerySample; story?: GallerySample }; metaCopyDefaults: MetaCopyDefaults; aiWritingGuidance: AiWritingGuidance; publishRequirements: PublishRequirements; replacementAssets: ReplacementAsset[]; realAssetRefs: RealAssetRef[]; }
export interface AdTemplate { schema: "blockwise.ad-template"; templateId: string; createdAt: string; feedLayout: Layout; storyLayout: Layout; imageInputs: ImageInput[]; textInputs: TextInput[]; semanticColours: Record<ColourRole, string>; assets: Record<string, { fileName: string; mimeType: string }>; fonts: FontRef[]; metadata: TemplateMetadata; }
export interface AdDocument { schema: "blockwise.ad-document"; templateId: string; sharedImageValues: Record<string, string>; sharedTextValues: Record<string, string>; feedCropOverrides: Record<string, Rect>; storyCropOverrides: Record<string, Rect>; colourMode: "template" | "brand_pack"; resolvedColourMap: Record<string, string>; metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string; revision: number; lastRenderedAt?: string | null; }
