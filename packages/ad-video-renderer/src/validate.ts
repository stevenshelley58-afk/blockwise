import { createHash } from "node:crypto";
import type { RenderRequest, ScenePlan, VideoAdProject, VideoAssetRef, VideoScriptPlan } from "./types.js";

export class RenderValidationError extends Error {
  readonly code = "render_validation_failed";
  constructor(message: string) { super(message); this.name = "RenderValidationError"; }
}

const REQUIRED: Record<string, string[]> = {
  home_value: ["logo"], sold_nearby: ["logo", "proof"], qualified_buyer_demand: ["logo"], suburb_pulse: ["logo", "proof"], seller_education: ["logo"], testimonial_case_study: ["logo", "testimonial"], rental_appraisal: ["logo"], pm_health_check: ["logo"],
};

export function validateRenderRequest(request: RenderRequest): { project: VideoAdProject; plan: VideoScriptPlan; fingerprint: string } {
  const project = parseProject(request.project);
  const plan = parsePlan(request.plan);
  if (project.durationSeconds !== plan.durationSeconds) fail("Project and script durations do not match.");
  if (project.productionRoute === "presenter" && !project.presenter?.trim()) fail("Presenter route requires consented presenter copy/footage.");
  if (project.productionRoute === "bookends" && !project.bookends?.trim()) fail("Bookends route requires approved bookend copy/footage.");
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (assets.size !== project.assets.length) fail("Asset IDs must be unique immutable references.");
  for (const asset of project.assets) validateAsset(asset, project);
  for (const kind of REQUIRED[project.recipeId] ?? ["logo"]) {
    if (!project.assets.some((asset) => asset.kind === kind)) fail(`Missing required ${kind} asset.`);
  }
  for (const scene of plan.scenes) {
    for (const id of scene.assetIds) if (!assets.has(id)) fail(`Scene ${scene.index} references missing immutable asset ${id}.`);
  }
  const consent = new Map((project.consentRecords ?? []).map((record) => [record.id, record]));
  for (const asset of project.assets.filter((item) => item.kind === "testimonial")) {
    if (!asset.consentId) fail(`Testimonial asset ${asset.id} is missing consent.`);
    const record = consent.get(asset.consentId);
    if (!record || record.status !== "approved" || (record.expiresAt && Date.parse(record.expiresAt) <= Date.now())) fail(`Consent for testimonial asset ${asset.id} is not approved.`);
  }
  for (const asset of project.assets.filter((item) => item.kind === "video")) {
    const attestation = asset.attestation ?? project.assetAttestations?.[asset.id];
    if (!attestation || attestation.status !== "validated") fail(`Video asset ${asset.id} is missing a validated codec/duration attestation.`);
  }
  return { project, plan, fingerprint: sha256(stableJson({ project, plan })) };
}

function parseProject(value: unknown): VideoAdProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Project must be an object.");
  const p = value as Record<string, unknown>;
  const requiredStrings = ["recipeId", "audience", "objective", "productionRoute", "hookStyle"];
  for (const key of requiredStrings) if (typeof p[key] !== "string" || !(p[key] as string).trim()) fail(`Project ${key} is required.`);
  if (p.productionRoute !== "presenter" && p.productionRoute !== "bookends" && p.productionRoute !== "no_camera") fail("Project production route is invalid.");
  if (p.hookStyle !== "question" && p.hookStyle !== "proof" && p.hookStyle !== "offer") fail("Project hook style is invalid.");
  if (p.durationSeconds !== 15 && p.durationSeconds !== 30) fail("Project duration must be 15 or 30 seconds.");
  if (!p.brief || typeof p.brief !== "object" || Array.isArray(p.brief)) fail("Project brief is required.");
  if (!Array.isArray(p.assets)) fail("Project assets are required.");
  if (!p.brandSnapshot || typeof p.brandSnapshot !== "object") p.brandSnapshot = {};
  return p as unknown as VideoAdProject;
}

function parsePlan(value: unknown): VideoScriptPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Script plan must be an object.");
  const wrapper = value as Record<string, unknown>; const p = (wrapper.scriptPlan && typeof wrapper.scriptPlan === "object" && !Array.isArray(wrapper.scriptPlan) ? wrapper.scriptPlan : value) as Record<string, unknown>;
  if (p.version !== 1 || (p.durationSeconds !== 15 && p.durationSeconds !== 30)) fail("Script plan version or duration is invalid.");
  if (!Array.isArray(p.scenes) || p.scenes.length !== 4) fail("Script plan must contain exactly four beats.");
  if (!Array.isArray(p.hookVariants) || p.hookVariants.length !== 3) fail("Script plan must contain exactly three hook variants.");
  for (const scene of p.scenes as ScenePlan[]) {
    if (!scene || scene.index < 1 || scene.index > 4 || typeof scene.narration !== "string" || typeof scene.overlay !== "string" || !Array.isArray(scene.assetIds)) fail("Script scene is invalid.");
  }
  if (typeof p.body !== "string" || typeof p.cta !== "string" || typeof p.promise !== "string") fail("Script plan copy is incomplete.");
  return p as unknown as VideoScriptPlan;
}

function validateAsset(asset: VideoAssetRef, project: VideoAdProject): void {
  if (!asset || typeof asset.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(asset.id)) fail("Asset IDs must be stable safe identifiers.");
  if (!["logo", "photo", "video", "testimonial", "proof", "music"].includes(asset.kind)) fail(`Asset ${asset.id} has an unsupported kind.`);
  if (typeof asset.url !== "string" || !(asset.url.startsWith("storage://") || asset.url.startsWith("/api/adstudio/media?") || /^https:\/\//u.test(asset.url))) fail(`Asset ${asset.id} must use an HTTPS, workspace media, or storage:// immutable reference.`);
  if (asset.rights?.status === "rejected" || asset.rights?.status === "pending") fail(`Rights for asset ${asset.id} are not approved.`);
  if (asset.attestation?.status === "rejected" || asset.attestation?.status === "pending") fail(`Attestation for asset ${asset.id} is not validated.`);
  if (asset.kind === "proof" && project.brief.verifiedProof && (!project.brief.proofSource || !project.brief.proofDate)) fail("Verified proof requires a named source and date.");
}

function fail(message: string): never { throw new RenderValidationError(message); }
export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
