import { z } from "zod";

export type VideoAudience = "buyers" | "sellers" | "renters";
export type VideoObjective = "new_listing" | "appraisal" | "local_expertise";
export type VideoPresenter = "agent" | "bookends" | "no_camera";
export type VideoHook = "new_here" | "question" | "proof";
export type VideoSceneKind = "hook" | "proof" | "value" | "cta";

export type VideoScene = {
  id: string;
  kind: VideoSceneKind;
  title: string;
  caption: string;
  assetLabel: string;
};

export type VideoDraft = {
  audience: VideoAudience;
  objective: VideoObjective;
  brief: string;
  presenter: VideoPresenter;
  hook: VideoHook;
  scenes: VideoScene[];
};

export type VideoJobState = "draft" | "queued" | "rendering" | "ready" | "failed";

export const VIDEO_RECIPE_IDS = [
  "home_value", "sold_nearby", "qualified_buyer_demand", "suburb_pulse",
  "seller_education", "testimonial_case_study", "rental_appraisal", "pm_health_check",
] as const;
export type VideoRecipeId = (typeof VIDEO_RECIPE_IDS)[number];
export const videoRecipeIdSchema = z.enum(VIDEO_RECIPE_IDS);
export const videoDurationSchema = z.union([z.literal(15), z.literal(30)]);
export type VideoDuration = z.infer<typeof videoDurationSchema>;
export const productionRouteSchema = z.enum(["presenter", "bookends", "no_camera"]);
export type ProductionRoute = z.infer<typeof productionRouteSchema>;
export const hookStyleSchema = z.enum(["question", "proof", "offer"]);
export type HookStyle = z.infer<typeof hookStyleSchema>;
export const videoDomainStatusSchema = z.enum(["draft", "script_ready", "render_queued", "rendering", "ready", "failed"]);
export type VideoDomainStatus = z.infer<typeof videoDomainStatusSchema>;

export const sceneBeatSchema = z.object({ beat: z.string().min(1).max(80), purpose: z.string().min(1).max(240) });
export type SceneBeat = z.infer<typeof sceneBeatSchema>;
export const videoRecipeSchema = z.object({
  id: videoRecipeIdSchema, name: z.string().min(1), audience: z.string().min(1),
  durationSeconds: z.array(videoDurationSchema).min(1), requiredAssets: z.array(z.string().min(1)),
  optionalAssets: z.array(z.string().min(1)), sceneBeats: z.array(sceneBeatSchema).length(4),
  supportedProductionRoutes: z.array(productionRouteSchema).min(1), fallbackPolicy: z.string().min(1),
  cta: z.string().min(1).max(80), claimRequirements: z.array(z.string().min(1)),
});
export type VideoRecipe = z.infer<typeof videoRecipeSchema>;

export const videoBriefSchema = z.object({
  serviceArea: z.string().trim().min(2).max(120), offer: z.string().trim().min(2).max(240),
  verifiedProof: z.string().trim().max(500).optional(), proofSource: z.string().trim().max(240).optional(),
  proofDate: z.string().trim().max(40).optional(), cta: z.string().trim().min(2).max(80).optional(),
  tone: z.string().trim().min(2).max(80).default("clear and local"),
});
export type VideoBrief = z.infer<typeof videoBriefSchema>;
export const videoAssetSchema = z.object({
  id: z.string().trim().min(1).max(160), kind: z.enum(["logo", "photo", "video", "testimonial", "proof", "music"]),
  // Stored Brand Pack/library assets use the auth-gated media proxy. The
  // workspace prefix is checked by parseVideoProjectInput when context exists.
  url: z.string().url().or(z.string().startsWith("storage://")).or(z.string().regex(/^\/api\/adstudio\/media\?path=[A-Za-z0-9._~%\-/]+$/u)), alt: z.string().max(240).optional(), consentId: z.string().trim().max(160).optional(),
});
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export const consentRecordSchema = z.object({
  id: z.string().trim().min(1).max(160), assetId: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(160),
  scope: z.string().trim().min(1).max(240), capturedAt: z.string().datetime(), expiresAt: z.string().datetime().optional(), status: z.enum(["pending", "approved", "rejected"]),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export const claimRecordSchema = z.object({
  id: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(240),
  verifiedAt: z.string().datetime(), status: z.enum(["verified", "needs_review", "rejected"]),
});
export type ClaimRecord = z.infer<typeof claimRecordSchema>;
export const brandSnapshotSchema = z.object({
  businessName: z.string().trim().min(1).max(160).optional(), primaryColour: z.string().trim().max(30).optional(), secondaryColour: z.string().trim().max(30).optional(), voice: z.string().trim().max(160).optional(), logoAssetId: z.string().trim().max(160).optional(),
});
export type BrandSnapshot = z.infer<typeof brandSnapshotSchema>;
export const scenePlanSchema = z.object({ index: z.number().int().min(1).max(4), beat: z.string().min(1).max(80), narration: z.string().min(1).max(360), overlay: z.string().max(80), assetIds: z.array(z.string().min(1).max(160)).max(8) });
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export const hookVariantSchema = z.object({ id: z.enum(["hook_a", "hook_b", "hook_c"]), style: hookStyleSchema, text: z.string().min(1).max(180) });
export type HookVariant = z.infer<typeof hookVariantSchema>;
export const videoScriptPlanSchema = z.object({
  version: z.literal(1), durationSeconds: videoDurationSchema, hookVariants: z.array(hookVariantSchema).length(3), selectedHookId: hookVariantSchema.shape.id,
  body: z.string().min(1).max(1000), cta: z.string().min(1).max(120), scenes: z.array(scenePlanSchema).length(4), wordCount: z.number().int().min(1), promise: z.string().min(1).max(240), source: z.enum(["provider", "deterministic"]),
});
export type VideoScriptPlan = z.infer<typeof videoScriptPlanSchema>;
export const videoProjectInputSchema = z.object({
  recipeId: videoRecipeIdSchema, audience: z.string().trim().min(2).max(160), objective: z.string().trim().min(2).max(240), brief: videoBriefSchema,
  presenter: z.string().trim().max(160).optional(), bookends: z.string().trim().max(400).optional(), productionRoute: productionRouteSchema.default("no_camera"), hookStyle: hookStyleSchema.default("question"), brandSnapshot: brandSnapshotSchema.default({}), assets: z.array(videoAssetSchema).max(40).default([]), captions: z.boolean().default(true), consentRecords: z.array(consentRecordSchema).max(40).default([]), claimRecords: z.array(claimRecordSchema).max(40).default([]), durationSeconds: videoDurationSchema.default(15),
});
export type VideoProjectInput = z.infer<typeof videoProjectInputSchema>;
export const videoProjectSchema = videoProjectInputSchema.extend({ id: z.string().min(1), workspaceId: z.string().min(1), scriptPlan: videoScriptPlanSchema.nullable(), status: videoDomainStatusSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), version: z.number().int().nonnegative() });
export type VideoAdProject = z.infer<typeof videoProjectSchema>;
