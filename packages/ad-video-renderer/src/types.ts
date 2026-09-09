export type ProductionRoute = "presenter" | "bookends" | "no_camera";
export type AssetKind = "logo" | "photo" | "video" | "testimonial" | "proof" | "music";
export type Transition = "hard_cut" | "short_dissolve" | "brand_wipe" | "smart_push";

export type VideoAssetRef = {
  id: string;
  kind: AssetKind;
  url: string;
  alt?: string;
  consentId?: string;
  /** Worker-only compliance fields are accepted when supplied by the API. */
  rights?: { status?: "approved" | "rejected" | "pending"; source?: string };
  attestation?: { status?: "validated" | "rejected" | "pending"; codec?: string; durationMs?: number };
};

export type ScenePlan = {
  index: number;
  beat: string;
  narration: string;
  overlay: string;
  assetIds: string[];
};

export type VideoScriptPlan = {
  version: 1;
  durationSeconds: 15 | 30;
  hookVariants: Array<{ id: "hook_a" | "hook_b" | "hook_c"; style: "question" | "proof" | "offer"; text: string }>;
  selectedHookId: "hook_a" | "hook_b" | "hook_c";
  body: string;
  cta: string;
  scenes: [ScenePlan, ScenePlan, ScenePlan, ScenePlan];
  wordCount: number;
  promise: string;
  source: "provider" | "deterministic";
};

export type BrandSnapshot = {
  businessName?: string;
  primaryColour?: string;
  secondaryColour?: string;
  voice?: string;
  logoAssetId?: string;
};

export type VideoAdProject = {
  recipeId: string;
  audience: string;
  objective: string;
  brief: { serviceArea: string; offer: string; cta?: string; verifiedProof?: string; proofSource?: string; proofDate?: string; tone?: string };
  presenter?: string;
  bookends?: string;
  productionRoute: ProductionRoute;
  hookStyle: "question" | "proof" | "offer";
  brandSnapshot: BrandSnapshot;
  assets: VideoAssetRef[];
  captions: boolean;
  consentRecords?: Array<{ id: string; assetId: string; status: "pending" | "approved" | "rejected"; expiresAt?: string }>;
  claimRecords?: Array<{ id: string; text: string; source: string; status: "verified" | "needs_review" | "rejected" }>;
  durationSeconds: 15 | 30;
  /** Optional attestation map written by an ingest/codec worker. */
  assetAttestations?: Record<string, { status: "validated" | "rejected" | "pending"; codec?: string; durationMs?: number }>;
};

export type RenderRequest = { jobId: string; workspaceId: string; projectId: string; project: unknown; plan: unknown };

export type ResolvedAsset = { bytes?: Uint8Array; path?: string; mimeType?: string };
export type AssetResolver = (asset: VideoAssetRef) => Promise<ResolvedAsset | null>;

export type RenderOptions = {
  outputDir: string;
  fps?: 24 | 30;
  transition?: Transition;
  executeFfmpeg?: boolean;
  ffmpegPath?: string;
  assetResolver?: AssetResolver;
  now?: () => Date;
};

export type RenderManifest = {
  schemaVersion: 1;
  renderer: "@blockwise/ad-video-renderer";
  rendererVersion: string;
  composition: { width: 1080; height: 1920; fps: number; durationSeconds: 15 | 30; beats: Array<{ index: number; kind: string; startSeconds: number; durationSeconds: number; transition: Transition; assetIds: string[] }> };
  fallbackAssets: string[];
  assetIds: string[];
  captions: boolean;
  audio: { codec: "aac"; ducking: boolean; source: "silent" | "music" };
  brand: { primaryColour: string; secondaryColour: string; businessName: string };
  deterministicFingerprint: string;
};

export type RenderResult = {
  manifest: RenderManifest;
  manifestPath: string;
  mp4Path: string | null;
  posterPath: string;
  captionsPath: string;
  sha256: string | null;
  durationMs: number;
  width: 1080;
  height: 1920;
  fps: number;
  providerMetadata: Record<string, unknown>;
  costMetadata: Record<string, unknown>;
};
