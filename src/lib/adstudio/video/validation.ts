import { z } from "zod";
import { getVideoRecipe } from "./recipes.ts";
import {
  videoBriefSchema,
  videoProjectInputSchema,
  videoScriptPlanSchema,
  type VideoBrief,
  type VideoProjectInput,
  type VideoScriptPlan,
} from "./types.ts";

export class VideoValidationError extends Error {
  readonly code = "video_validation_failed";
  readonly issues: string[];

  constructor(issues: string[] | string) {
    const list = Array.isArray(issues) ? issues : [issues];
    super(list.join(" "));
    this.name = "VideoValidationError";
    this.issues = list;
  }
}

// A valuation/appraisal is a valid service CTA. Reject only unsupported
// precision (a stated amount/value) and the prohibited guarantees/rankings.
const UNSUPPORTED_CLAIM = /(?:^|\b)(?:#\s*1|number\s+one|guarantee(?:d|s)?|buyer\s*count|\d[\d,.]*\s+buyers?|(?:valuation|appraisal|property\s+value|home\s+value|worth|valued\s+at)\b[^.\n]{0,32}(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:k|m|million|billion|thousand|dollars?))|(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:k|m|million|billion|thousand|dollars?))[^.\n]{0,32}\b(?:valuation|appraisal|property\s+value|home\s+value|worth)\b)(?:\b|$)/iu;
const LISTING_SALE_COPY = /(?:\bfor\s+sale\b|open\s+home|inspection\s+today|auction\s+this|offers?\s+over|buy\s+now|bedrooms?\s*\d)/iu;

export function parseVideoProjectInput(value: unknown, options: { requireReadiness?: boolean; workspaceId?: string } = {}): VideoProjectInput {
  const result = videoProjectInputSchema.safeParse(value);
  if (!result.success) throw new VideoValidationError(formatZodIssues(result.error));

  const input = result.data;
  if (options.workspaceId) {
    for (const asset of input.assets) {
      if (asset.url.startsWith("storage://")) {
        const storagePath = asset.url.replace(/^storage:\/\/[^/]+\//u, "");
        if (!storagePath.startsWith(`${options.workspaceId}/`) || storagePath.includes("..")) throw new VideoValidationError(`Asset ${asset.id} is outside this workspace.`);
        continue;
      }
      if (!asset.url.startsWith("/api/adstudio/media?path=")) continue;
      const encodedPath = asset.url.slice("/api/adstudio/media?path=".length);
      let path: string;
      try { path = decodeURIComponent(encodedPath); } catch { throw new VideoValidationError(`Asset ${asset.id} has an invalid workspace media path.`); }
      if (!path.startsWith(`${options.workspaceId}/`) || path.includes("..")) throw new VideoValidationError(`Asset ${asset.id} is outside this workspace.`);
    }
  }
  const recipe = getVideoRecipe(input.recipeId);
  const issues: string[] = [];
  const requireReadiness = options.requireReadiness !== false;
  if (requireReadiness) {
    if (!recipe.durationSeconds.includes(input.durationSeconds)) issues.push("That recipe does not support the requested duration.");
    if (!recipe.supportedProductionRoutes.includes(input.productionRoute)) issues.push("That production route is not supported by the selected recipe.");
    if (recipe.requiredAssets.some((kind) => !input.assets.some((asset) => asset.kind === kind))) {
      issues.push(`This recipe requires approved ${recipe.requiredAssets.join(", ")} asset(s).`);
    }
    const consentById = new Map(input.consentRecords.map((record) => [record.id, record]));
    for (const asset of input.assets) {
      const consent = asset.consentId ? consentById.get(asset.consentId) : undefined;
      if (asset.consentId && (!consent || consent.assetId !== asset.id || consent.status !== "approved")) {
        issues.push(`Asset ${asset.id} requires a matching approved consent record.`);
      } else if (consent?.expiresAt && Date.parse(consent.expiresAt) <= Date.now()) {
        issues.push(`Consent for asset ${asset.id} has expired.`);
      }
    }
    if (recipe.requiredAssets.includes("testimonial")) {
      for (const asset of input.assets.filter((candidate) => candidate.kind === "testimonial")) {
        const consent = asset.consentId ? consentById.get(asset.consentId) : undefined;
        if (!consent || consent.assetId !== asset.id || consent.status !== "approved") {
          issues.push(`Testimonial asset ${asset.id} requires approved subject consent.`);
        }
      }
    }
    if (input.productionRoute === "presenter" && !input.presenter) issues.push("A presenter is required for this production route.");
    if (input.productionRoute === "bookends" && !input.bookends) issues.push("Bookend copy is required for this production route.");
  }
  if (requireReadiness && input.brief.verifiedProof && (!input.brief.proofSource || !input.brief.proofDate)) {
    issues.push("Verified proof must include its source and date.");
  }
  const allText = [input.objective, input.brief.offer, input.brief.creativeBrief, input.brief.verifiedProof, ...input.claimRecords.map((claim) => claim.text)].filter(Boolean).join(" ");
  if (UNSUPPORTED_CLAIM.test(allText) && !hasVerifiedMatchingClaim(input)) issues.push("Unsupported number-one, guarantee, valuation, or buyer-count claims are not allowed.");
  if (input.claimRecords.some((claim) => claim.status !== "verified" && UNSUPPORTED_CLAIM.test(claim.text))) issues.push("Claims used in video copy must have a verified source.");
  if (LISTING_SALE_COPY.test(allText)) issues.push("Listing-sale copy is not allowed in lead-generation video briefs.");
  if (issues.length) throw new VideoValidationError(issues);
  return input;
}

export function parseVideoBrief(value: unknown): VideoBrief {
  const result = videoBriefSchema.safeParse(value);
  if (!result.success) throw new VideoValidationError(formatZodIssues(result.error));
  if (result.data.verifiedProof && (!result.data.proofSource || !result.data.proofDate)) {
    throw new VideoValidationError("Verified proof must include its source and date.");
  }
  return result.data;
}

export function validateVideoScriptPlan(value: unknown, input?: Pick<VideoProjectInput, "durationSeconds" | "brief">): VideoScriptPlan {
  const result = videoScriptPlanSchema.safeParse(value);
  if (!result.success) throw new VideoValidationError(formatZodIssues(result.error));
  const plan = result.data;
  const duration = input?.durationSeconds ?? plan.durationSeconds;
  const count = countWords([plan.body, plan.cta].join(" "));
  const [min, max] = duration === 15 ? [30, 40] : [60, 75];
  const issues: string[] = [];
  if (plan.durationSeconds !== duration) issues.push("Script duration does not match the project.");
  if (count < min || count > max) issues.push(`Script must contain ${min}-${max} spoken words for ${duration} seconds.`);
  if (plan.wordCount !== count) issues.push("Script word count is stale.");
  if (plan.hookVariants.length !== 3) issues.push("Exactly three hook variants are required.");
  if (new Set(plan.hookVariants.map((hook) => hook.text.trim().toLowerCase())).size !== 3) issues.push("Hook variants must be distinct.");
  if (plan.scenes.length !== 4) issues.push("Exactly four scene beats are required.");
  if (plan.scenes.some((scene) => countWords(scene.overlay) > 7)) issues.push("On-screen overlays must be seven words or fewer.");
  const allText = [plan.body, plan.cta, ...plan.hookVariants.map((hook) => hook.text), ...plan.scenes.map((scene) => `${scene.narration} ${scene.overlay}`)].join(" ");
  if (UNSUPPORTED_CLAIM.test(allText)) issues.push("Unsupported number-one, guarantee, valuation, or buyer-count claims are not allowed.");
  if (LISTING_SALE_COPY.test(allText)) issues.push("Listing-sale copy is not allowed in lead-generation video scripts.");
  if (input) {
    const area = input.brief.serviceArea.toLocaleLowerCase();
    if (!allText.toLocaleLowerCase().includes(area)) issues.push("Local service area must be present in the script.");
    if (!plan.hookVariants.every((hook) => hook.text.toLocaleLowerCase().includes(area)) || !plan.scenes[0]?.narration.toLocaleLowerCase().includes(area)) issues.push("Local service area must be the first intent in the script.");
  }
  if (!plan.cta.trim() || !plan.body.toLocaleLowerCase().includes(plan.promise.toLocaleLowerCase())) issues.push("The script must contain one clear promise and a CTA.");
  if (issues.length) throw new VideoValidationError(issues);
  return { ...plan, wordCount: count };
}

export function countWords(text: string): number {
  return text.trim().match(/\b[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?\b/gu)?.length ?? 0;
}

function hasVerifiedMatchingClaim(input: VideoProjectInput): boolean {
  const verified = input.claimRecords.filter((claim) => claim.status === "verified");
  return verified.length > 0 && verified.some((claim) => UNSUPPORTED_CLAIM.test(claim.text));
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
}
