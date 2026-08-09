import { createHash } from "node:crypto";

import {
  createTextProviderForCandidate,
  type ProviderEnvironment,
} from "./ai-providers.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import type { ImageProviderRequest, TextProviderResponse } from "./providers.ts";
import {
  adStudioCloneQualityReviewSchema,
  type AdStudioCloneQualityReview,
} from "./types.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptSection } from "../operator/prompts/prompt-registry.ts";
import {
  executeAdStudioProviderAttempt,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

export const MIN_RUNTIME_AD_SYSTEM_LIKENESS = 9.5;
export const MIN_RUNTIME_STANDALONE_AD_QUALITY = 9;
export const MAX_RUNTIME_CLONE_CANDIDATES = 3;

class CloneQualitySchemaError extends Error {}

export class TemplateCampaignQaError extends Error {
  readonly review?: AdStudioCloneQualityReview;

  constructor(message: string, review?: AdStudioCloneQualityReview) {
    super(message);
    this.name = "TemplateCampaignQaError";
    this.review = review;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function imageBytes(value: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (value.startsWith("data:image/")) return dataUrlToUploadBytes(value).bytes;
  const response = await fetchImpl(value);
  if (!response.ok) throw new Error(`Clone QA image could not be read (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function buildCloneQualityContactSheet(
  referenceImage: string,
  candidateImage: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ imageUrl: string; referenceHash: string; candidateHash: string }> {
  const [referenceBytes, candidateBytes] = await Promise.all([
    imageBytes(referenceImage, fetchImpl),
    imageBytes(candidateImage, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const candidateMetadata = await sharp(candidateBytes).metadata();
  if (!candidateMetadata.width || !candidateMetadata.height) throw new Error("Clone QA candidate dimensions could not be read.");
  const panelWidth = candidateMetadata.width;
  const panelHeight = candidateMetadata.height;
  const labelHeight = Math.max(48, Math.round(panelWidth * 0.06));
  const referencePanel = await sharp(referenceBytes)
    .resize(panelWidth, panelHeight, { fit: "contain", background: "#111111" })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const candidatePanel = await sharp(candidateBytes)
    .resize(panelWidth, panelHeight, { fit: "contain", background: "#111111" })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const label = (text: string) => Buffer.from(
    `<svg width="${panelWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111111"/><text x="24" y="${Math.round(labelHeight * 0.68)}" font-family="Arial, sans-serif" font-size="${Math.round(labelHeight * 0.38)}" font-weight="700" fill="#ffffff">${text}</text></svg>`,
  );
  const sheet = await sharp({
    create: { width: panelWidth * 2, height: panelHeight + labelHeight, channels: 4, background: "#111111" },
  }).composite([
    { input: label("APPROVED SAMPLE"), left: 0, top: 0 },
    { input: label("CUSTOMER CANDIDATE"), left: panelWidth, top: 0 },
    { input: referencePanel, left: 0, top: labelHeight },
    { input: candidatePanel, left: panelWidth, top: labelHeight },
  ]).png({ compressionLevel: 1 }).toBuffer();
  return {
    imageUrl: `data:image/png;base64,${sheet.toString("base64")}`,
    referenceHash: sha256(referenceBytes),
    candidateHash: sha256(candidateBytes),
  };
}

export function cloneRequestHash(request: ImageProviderRequest): string {
  return sha256(JSON.stringify({
    prompt: request.prompt,
    negativePrompt: request.negativePrompt ?? "",
    aspectRatio: request.aspectRatio,
    stylePreset: request.stylePreset,
    seed: request.seed ?? 0,
    referenceAssets: request.referenceAssets.map((reference) => sha256(reference)),
  }));
}

export function cloneQualityPassed(input: {
  review: AdStudioCloneQualityReview;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
}): boolean {
  const copyChecks = new Map(input.review.copyChecks.map((check) => [check.key, check]));
  const assetChecks = new Map(input.review.assetChecks.map((check) => [check.key, check]));
  return input.review.adSystemLikenessScore >= MIN_RUNTIME_AD_SYSTEM_LIKENESS
    && input.review.standaloneAdQualityScore >= MIN_RUNTIME_STANDALONE_AD_QUALITY
    && input.review.excludedContentInfluencedScore === false
    && Object.entries(input.expectedCopy).every(([key, expected]) => {
      const check = copyChecks.get(key);
      return Boolean(check)
        && visibleCopyText(check!.expected) === visibleCopyText(expected)
        && visibleCopyText(check!.rendered) === visibleCopyText(expected);
    })
    && input.expectedAssetKeys.every((key) => {
      const check = assetChecks.get(key);
      return check?.used === true && check.faithful === true;
    })
    && input.review.identityLeakage.length === 0
    && input.review.defects.length === 0;
}

/**
 * Line wrapping is layout, not a change to the customer's visible wording.
 * Collapse only whitespace that vision OCR inserts between otherwise exact
 * visible tokens; punctuation, spelling, symbols, and ordering stay strict.
 */
function visibleCopyText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * A sub-threshold vision review must always drive the next paid candidate.
 * Some strict-schema models leave suggestedCorrection blank while describing
 * the mismatch precisely in their rationales. Preserve that image-model
 * diagnosis instead of ending the quality loop early or inventing a layout.
 */
export function cloneCorrectionForNextCandidate(review: AdStudioCloneQualityReview): string {
  const explicit = review.suggestedCorrection.trim();
  if (explicit) return explicit.slice(0, 2_400);

  const findings = [
    review.qualityRationale.trim()
      ? `Correct the image-model review findings: ${review.qualityRationale.trim()}`
      : `Raise reusable-system likeness from ${review.adSystemLikenessScore}/10 and standalone quality from ${review.standaloneAdQualityScore}/10 by matching reference image 1 more faithfully.`,
    review.defects.length ? `Remove these visible defects: ${review.defects.join("; ")}.` : "",
    review.identityLeakage.length ? `Remove this reference identity leakage: ${review.identityLeakage.join("; ")}.` : "",
    review.copyChecks.some((check) => visibleCopyText(check.rendered) !== visibleCopyText(check.expected))
      ? "Restore every supplied visible word, symbol, and punctuation mark exactly; natural line wrapping inside the reference text box is allowed."
      : "",
    review.assetChecks.some((check) => !check.used || !check.faithful)
      ? "Use every supplied replacement asset faithfully in its matching reference slot without warping it."
      : "",
    review.includedRationale.trim()
      ? `Preserve everything the image-model review says already matches: ${review.includedRationale.trim()}`
      : "",
  ].filter(Boolean).join(" ");

  return findings.slice(0, 2_400);
}

export async function reviewCloneCandidate(input: {
  templateId: string;
  format: "4:5" | "9:16";
  attempt: number;
  referenceImage: string;
  candidateImage: string;
  request: ImageProviderRequest;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
  workspaceId: string;
  userId: string;
  correlationId: string;
  /** Explicit service-runtime credentials; web requests use process.env. */
  providerEnv?: ProviderEnvironment;
  signal?: AbortSignal;
}, dependencies: {
  fetchImpl?: typeof fetch;
  contactSheet?: typeof buildCloneQualityContactSheet;
} = {}): Promise<AdStudioCloneQualityReview> {
  const startedAt = Date.now();
  const contact = await (dependencies.contactSheet ?? buildCloneQualityContactSheet)(
    input.referenceImage,
    input.candidateImage,
    dependencies.fetchImpl ?? fetch,
  );
  const requestHash = cloneRequestHash(input.request);
  const section = await getActivePromptSection("adstudio.clone_qa");
  const contract = [
    "RUNTIME CONTRACT: this contract supersedes any earlier scoring rubric, region list, or output shape in the governed prompt above.",
    "The image is a two-panel contact sheet: approved public sample on the left, customer candidate on the right.",
    "Score the reusable ad system, not replaceable property/photo subject matter, logo identity, or copy wording.",
    "Do score canvas/panel geometry, borders, margins, image crop and effects, logo displayed footprint/anchor, text-block bounds and line rhythm, typography treatment, hierarchy, whitespace, palette, CTA and footer treatment.",
    "Different customer copy lengths may wrap to a different natural line count. Do not penalize that fact alone: score whether the replacement occupies the same text-box anchor and outer bounds with faithful type treatment and natural spacing. Never split a word unnaturally just to mimic the sample line count.",
    "For copyChecks, compare visible words, punctuation, symbols, and order after collapsing layout whitespace. OCR line breaks and repeated spaces are not changed copy; score their visual rhythm under ad-system likeness instead.",
    `Expected exact copy: ${JSON.stringify(input.expectedCopy)}.`,
    `Required replaced asset regions: ${JSON.stringify(input.expectedAssetKeys)}. An asset is used only if the candidate visibly replaces the corresponding sample asset; faithful means visibly clean and unwarped.`,
    `Bind the JSON to schemaVersion 1, templateId ${input.templateId}, format ${input.format}, attempt ${input.attempt}, referenceHash ${contact.referenceHash}, candidateHash ${contact.candidateHash}, requestHash ${requestHash}.`,
    "adSystemLikenessScore and standaloneAdQualityScore must each be JSON numbers on a 0-10 scale, never percentages or strings.",
    "Return only the current adStudioCloneQualityReview JSON schema and every one of its fields. Do not return regions or any legacy QA shape. Whenever either score or any exactness/asset/defect/leakage gate fails, suggestedCorrection must be a non-empty concise actionable visual edit for the next full clone; only a passing review may leave it empty.",
  ].join("\n");
  const prompt = {
    system: `${section.body}\n\n${contract}`,
    user: "Review the approved sample and customer candidate now. Return JSON only.",
    fullPrompt: `${section.body}\n\n${contract}\n\nReview the approved sample and customer candidate now. Return JSON only.`,
    promptVersions: [{ key: section.key, version: section.version, id: section.id, source: section.source }],
    fallbackPromptUsed: section.source === "fallback",
    warnings: section.source === "fallback" ? [`${section.key} used bundled fallback.`] : [],
  };
  const mutationId = `${input.correlationId}:adstudio.clone_qa:${input.format}:${input.attempt}`;
  const profile = await resolveRuntimeModelProfile("vision_classification");
  const attempts: ProviderRunAttempt[] = [];
  let finalOutput: TextProviderResponse | null = null;
  let finalReview: AdStudioCloneQualityReview | null = null;
  let finalProvider = "unavailable";
  let finalModel = "unavailable";
  let lastError: unknown = null;
  let schemaError: CloneQualitySchemaError | null = null;

  for (const [attemptIndex, candidate] of modelCandidateAttempts(profile).entries()) {
    const provider = createTextProviderForCandidate(candidate, { env: input.providerEnv });
    if (!provider.capabilities.visionInput) continue;
    const execution = await executeAdStudioProviderAttempt<TextProviderResponse>({
      workspaceId: input.workspaceId,
      mutationId,
      attemptIndex,
      modelProfile: "vision_classification",
      provider,
      execute: () => provider.generate({
        system: prompt.system,
        schemaName: "adStudioCloneQualityReview",
        messages: [{ role: "user", content: prompt.user }],
        imageUrl: contact.imageUrl,
        signal: input.signal,
      }),
    });
    attempts.push(execution.attempt);
    if (execution.ok) {
      const parsed = adStudioCloneQualityReviewSchema.safeParse(execution.output.json);
      if (parsed.success) {
        finalOutput = execution.output;
        finalReview = parsed.data;
        finalProvider = provider.providerName;
        finalModel = String(execution.output.providerMetadata.model ?? candidate.model);
        break;
      }
      schemaError = new CloneQualitySchemaError(`Clone QA returned an invalid schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`);
      lastError = schemaError;
      continue;
    }
    lastError = execution.error;
    if (!(lastError instanceof CloneQualitySchemaError) && !isProviderFallbackEligible(lastError)) break;
  }

  const finalError = !finalReview && schemaError
    ? new CloneQualitySchemaError(
      `${schemaError.message}${lastError !== schemaError && lastError instanceof Error ? `; fallback failed: ${lastError.message}` : ""}`,
    )
    : lastError;

  await recordAdStudioProviderRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone_qa",
    modelProfile: "vision_classification",
    mutationId,
    prompt,
    input: {
      templateId: input.templateId,
      format: input.format,
      attempt: input.attempt,
      referenceHash: contact.referenceHash,
      candidateHash: contact.candidateHash,
      requestHash,
      copyKeys: Object.keys(input.expectedCopy),
      assetKeys: input.expectedAssetKeys,
    },
    attempts,
    latencyMs: Date.now() - startedAt,
    providerName: finalProvider,
    providerType: "text_generation",
    modelName: finalModel,
    output: finalOutput,
    status: finalReview ? "completed" : "failed",
    error: finalReview ? undefined : finalError,
  });
  if (!finalReview) throw new TemplateCampaignQaError(finalError instanceof Error ? finalError.message : "Clone quality review failed.");

  const bindingMatches = finalReview.templateId === input.templateId
    && finalReview.format === input.format
    && finalReview.attempt === input.attempt
    && finalReview.referenceHash === contact.referenceHash
    && finalReview.candidateHash === contact.candidateHash
    && finalReview.requestHash === requestHash;
  if (!bindingMatches) throw new TemplateCampaignQaError("Clone quality review was not bound to this exact candidate.");
  return finalReview;
}
