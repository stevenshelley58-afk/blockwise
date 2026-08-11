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
// Cheap tiers still get one shot by default. A visually clean near-pass may
// retry its corrected request once before escalation, and the final/highest
// quality tier gets one corrected retry before the run fails closed.
export const MAX_RUNTIME_CLONE_CANDIDATES = 5;
/** A malformed or transient QA response may be retried against the same paid image. */
// First retry the primary reviewer once, then use the independently priced
// fallback once when configured. This never creates another image candidate.
export const MAX_RUNTIME_CLONE_QA_ATTEMPTS = 3;

class CloneQualitySchemaError extends Error {}

export class TemplateCampaignQaError extends Error {
  readonly review?: AdStudioCloneQualityReview;
  readonly aborted: boolean;

  constructor(
    message: string,
    review?: AdStudioCloneQualityReview,
    options: { aborted?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TemplateCampaignQaError";
    this.review = review;
    this.aborted = options.aborted === true;
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof TemplateCampaignQaError && error.aborted) return true;
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
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

type CloneQualityCustomerAsset = {
  key: string;
  image: string;
};

type CloneQualityContactSheet = {
  imageUrl: string;
  referenceHash: string;
  candidateHash: string;
  assetReferences: Array<{ key: string; contentHash: string }>;
};

function escapeSvgText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export async function buildCloneQualityContactSheet(
  referenceImage: string,
  candidateImage: string,
  customerAssets: CloneQualityCustomerAsset[],
  fetchImpl: typeof fetch = fetch,
): Promise<CloneQualityContactSheet> {
  const [referenceBytes, candidateBytes, ...customerAssetBytes] = await Promise.all([
    imageBytes(referenceImage, fetchImpl),
    imageBytes(candidateImage, fetchImpl),
    ...customerAssets.map((asset) => imageBytes(asset.image, fetchImpl)),
  ]);
  const { default: sharp } = await import("sharp");
  const candidateMetadata = await sharp(candidateBytes).metadata();
  if (!candidateMetadata.width || !candidateMetadata.height) throw new Error("Clone QA candidate dimensions could not be read.");
  const panelWidth = candidateMetadata.width;
  const panelHeight = candidateMetadata.height;
  const designLabelHeight = Math.max(48, Math.round(panelWidth * 0.06));
  const sheetWidth = panelWidth * 2;
  const renderPanel = (bytes: Uint8Array, width: number, height: number) => sharp(bytes)
    .resize(width, height, { fit: "contain", background: "#111111" })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const [referencePanel, candidatePanel] = await Promise.all([
    renderPanel(referenceBytes, panelWidth, panelHeight),
    renderPanel(candidateBytes, panelWidth, panelHeight),
  ]);
  const label = (text: string, width: number, height: number) => Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111111"/><text x="24" y="${Math.round(height * 0.68)}" font-family="Arial, sans-serif" font-size="${Math.round(height * 0.32)}" font-weight="700" fill="#ffffff">${escapeSvgText(text)}</text></svg>`,
  );
  const designRowHeight = panelHeight + designLabelHeight;
  const assetColumnCount = customerAssets.length > 2 ? 3 : 2;
  const assetPanelWidth = Math.floor(sheetWidth / assetColumnCount);
  const assetPanelHeight = Math.max(1, Math.round(panelHeight * 0.35));
  const assetLabelHeight = Math.max(48, Math.round(assetPanelWidth * 0.045));
  const assetRowHeight = assetPanelHeight + assetLabelHeight;
  const assetRowCount = Math.ceil(customerAssets.length / assetColumnCount);
  const assetPanels = await Promise.all(
    customerAssetBytes.map((bytes) => renderPanel(bytes, assetPanelWidth, assetPanelHeight)),
  );
  const assetComposites = customerAssets.flatMap((asset, index) => {
    const left = (index % assetColumnCount) * assetPanelWidth;
    const top = designRowHeight + Math.floor(index / assetColumnCount) * assetRowHeight;
    return [
      { input: label(`CUSTOMER ASSET: ${asset.key}`, assetPanelWidth, assetLabelHeight), left, top },
      { input: assetPanels[index]!, left, top: top + assetLabelHeight },
    ];
  });
  const sheet = await sharp({
    create: {
      width: sheetWidth,
      height: designRowHeight + assetRowHeight * assetRowCount,
      channels: 4,
      background: "#111111",
    },
  }).composite([
    { input: label("APPROVED SAMPLE", panelWidth, designLabelHeight), left: 0, top: 0 },
    { input: label("CUSTOMER CANDIDATE", panelWidth, designLabelHeight), left: panelWidth, top: 0 },
    { input: referencePanel, left: 0, top: designLabelHeight },
    { input: candidatePanel, left: panelWidth, top: designLabelHeight },
    ...assetComposites,
  ]).png({ compressionLevel: 1 }).toBuffer();
  return {
    imageUrl: `data:image/png;base64,${sheet.toString("base64")}`,
    referenceHash: sha256(referenceBytes),
    candidateHash: sha256(candidateBytes),
    assetReferences: customerAssets.map((asset, index) => ({
      key: asset.key,
      contentHash: sha256(customerAssetBytes[index]!),
    })),
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
 * A clean 9+ result is close enough that applying the vision model's concrete
 * correction on the same tier is usually cheaper than escalating immediately.
 * Hard copy, asset, leakage, and defect failures always advance instead.
 */
export function cloneQualityWarrantsSameTierRetry(input: {
  review: AdStudioCloneQualityReview;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
}): boolean {
  return input.review.adSystemLikenessScore < MIN_RUNTIME_AD_SYSTEM_LIKENESS
    && cloneQualityHasCleanNearPassEvidence(input);
}

function cloneQualityHasCleanNearPassEvidence(input: {
  review: AdStudioCloneQualityReview;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
}): boolean {
  const copyChecks = new Map(input.review.copyChecks.map((check) => [check.key, check]));
  const assetChecks = new Map(input.review.assetChecks.map((check) => [check.key, check]));
  return input.review.adSystemLikenessScore >= 9
    && input.review.standaloneAdQualityScore >= MIN_RUNTIME_STANDALONE_AD_QUALITY
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
 * Ask vision to independently re-check a clean near-pass when its own output
 * is internally inconsistent: it rejected the image but supplied no concrete
 * correction. A second vision call is much cheaper than buying another image,
 * and the 9.5 acceptance threshold remains unchanged.
 */
export function cloneQualityNeedsIndependentConfirmation(input: {
  review: AdStudioCloneQualityReview;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
}): boolean {
  return input.review.suggestedCorrection.trim() === ""
    && !cloneQualityPassed(input)
    && cloneQualityHasCleanNearPassEvidence(input);
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
  resolveProfile?: typeof resolveRuntimeModelProfile;
  getPromptSection?: typeof getActivePromptSection;
  createProvider?: typeof createTextProviderForCandidate;
  executeProviderAttempt?: typeof executeAdStudioProviderAttempt;
  recordProviderRun?: typeof recordAdStudioProviderRun;
  onAttemptReceipts?: (attempts: readonly ProviderRunAttempt[]) => void;
} = {}): Promise<AdStudioCloneQualityReview> {
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Clone QA cancelled.", "AbortError");
  const startedAt = Date.now();
  const requestCustomerAssets = input.request.referenceAssets.slice(1);
  if (requestCustomerAssets.length !== input.expectedAssetKeys.length) {
    throw new TemplateCampaignQaError(
      "Clone quality review requires one exact labelled customer asset for every expected asset region.",
    );
  }
  const customerAssets = input.expectedAssetKeys.map((key, index) => ({
    key,
    image: requestCustomerAssets[index]!,
  }));
  const contact = await (dependencies.contactSheet ?? buildCloneQualityContactSheet)(
    input.referenceImage,
    input.candidateImage,
    customerAssets,
    dependencies.fetchImpl ?? fetch,
  );
  if (
    contact.assetReferences.length !== customerAssets.length
    || contact.assetReferences.some((asset, index) =>
      asset.key !== customerAssets[index]?.key || !/^[a-f0-9]{64}$/u.test(asset.contentHash),
    )
  ) {
    throw new TemplateCampaignQaError(
      "Clone quality review cannot claim customer asset faithfulness without exact labelled asset comparisons.",
    );
  }
  const requestHash = cloneRequestHash(input.request);
  const section = await (dependencies.getPromptSection ?? getActivePromptSection)("adstudio.clone_qa");
  const contract = [
    "RUNTIME CONTRACT: this contract supersedes any earlier scoring rubric, region list, or output shape in the governed prompt above.",
    "The image is a labelled contact sheet: approved public sample at top left, customer candidate at top right, followed by one CUSTOMER ASSET panel for every supplied customer image.",
    "Score the reusable ad system, not replaceable property/photo subject matter, logo identity, or copy wording.",
    "Do not judge a supplied customer asset against the sample asset's realism, identity, subject, composition, or style. The labelled CUSTOMER ASSET panel is the only authority for that replacement content.",
    "Boolean semantics are strict: excludedContentInfluencedScore MUST be false when you successfully ignored replaceable photo subject matter, logo identity, and copy wording while scoring. Set it true only when those excluded content differences improperly changed either numeric score. A compliant subject-invariant review normally returns false.",
    "Do score canvas/panel geometry, borders, margins, image crop and effects, logo displayed footprint/anchor, text-block bounds and line rhythm, typography treatment, hierarchy, whitespace, palette, CTA and footer treatment.",
    "Different customer copy lengths may wrap to a different natural line count. Do not penalize that fact alone: score whether the replacement occupies the same text-box anchor and outer bounds with faithful type treatment and natural spacing. Never split a word unnaturally just to mimic the sample line count.",
    "For copyChecks, compare visible words, punctuation, symbols, and order after collapsing layout whitespace. OCR line breaks and repeated spaces are not changed copy; score their visual rhythm under ad-system likeness instead.",
    `Expected exact copy: ${JSON.stringify(input.expectedCopy)}.`,
    `Required replaced asset regions and labelled comparison hashes: ${JSON.stringify(contact.assetReferences)}. For each assetChecks entry, used may be true only when the matching labelled CUSTOMER ASSET is visibly present in the candidate's corresponding slot. Faithful may be true only after visually comparing that candidate region to the labelled customer asset and confirming its subject/identity and original visible content were preserved without substitution, fabrication, repainting, warping, or destructive crop. Template masks, overlays, fades, and non-destructive fitting are allowed. Include concise notes describing what was actually observed.`,
    "Never suggest replacing a supplied customer asset with a more realistic, polished, or stylistically similar substitute. If the supplied asset limits standalone quality, report that limitation while preserving the exact customer asset.",
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
  const profile = await (dependencies.resolveProfile ?? resolveRuntimeModelProfile)("vision_classification");
  const attempts: ProviderRunAttempt[] = [];
  let finalOutput: TextProviderResponse | null = null;
  let finalReview: AdStudioCloneQualityReview | null = null;
  let finalProvider = "unavailable";
  let finalModel = "unavailable";
  let lastError: unknown = null;
  let schemaError: CloneQualitySchemaError | null = null;
  let confirmationRequested = false;

  const qaProviders = modelCandidateAttempts(profile)
    .map((candidate) => ({
      candidate,
      provider: (dependencies.createProvider ?? createTextProviderForCandidate)(candidate, { env: input.providerEnv }),
    }))
    .filter(({ provider }) => provider.capabilities.visionInput);
  const [primary, fallback] = qaProviders;
  const qaAttempts = primary
    ? [primary, ...(fallback ? [fallback, primary] : [primary])].slice(0, MAX_RUNTIME_CLONE_QA_ATTEMPTS)
    : [];

  for (const [attemptIndex, qaAttempt] of qaAttempts.entries()) {
    if (input.signal?.aborted) {
      lastError = input.signal.reason ?? new DOMException("Clone QA cancelled.", "AbortError");
      break;
    }
    const { candidate, provider } = qaAttempt;
    const execution = await (dependencies.executeProviderAttempt ?? executeAdStudioProviderAttempt)<TextProviderResponse>({
      workspaceId: input.workspaceId,
      mutationId,
      attemptIndex,
      modelProfile: "vision_classification",
      provider,
      execute: () => provider.generate({
        system: confirmationRequested
          ? `${prompt.system}\n\nINDEPENDENT VISION CONFIRMATION: A prior vision review returned clean evidence that could not be accepted, but supplied no actionable correction. Re-evaluate the pixels independently; do not inherit or average the prior score. If this candidate is below 9.5 likeness or any other gate fails, suggestedCorrection MUST name the exact spatial, typography, or treatment changes needed. If it genuinely reaches the contract, score it accordingly. Keep the same JSON schema.`
          : prompt.system,
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
        if (
          !confirmationRequested
          && attemptIndex + 1 < qaAttempts.length
          && cloneQualityNeedsIndependentConfirmation({
            review: parsed.data,
            expectedCopy: input.expectedCopy,
            expectedAssetKeys: input.expectedAssetKeys,
          })
        ) {
          confirmationRequested = true;
          finalOutput = execution.output;
          finalReview = parsed.data;
          finalProvider = provider.providerName;
          finalModel = String(execution.output.providerMetadata.model ?? candidate.model);
          continue;
        }
        finalOutput = execution.output;
        finalReview = parsed.data;
        finalProvider = provider.providerName;
        finalModel = String(execution.output.providerMetadata.model ?? candidate.model);
        break;
      }
      schemaError = new CloneQualitySchemaError(`Clone QA returned an invalid schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`);
      lastError = schemaError;
      if (confirmationRequested) break;
      if (attemptIndex + 1 < qaAttempts.length) continue;
      break;
    }
    lastError = execution.error;
    if (confirmationRequested) break;
    if (isAbortError(lastError) || !isProviderFallbackEligible(lastError)) break;
    if (attemptIndex + 1 < qaAttempts.length) continue;
    break;
  }

  const finalError = !finalReview && schemaError
    ? new CloneQualitySchemaError(
      `${schemaError.message}${lastError !== schemaError && lastError instanceof Error ? `; fallback failed: ${lastError.message}` : ""}`,
    )
    : lastError;

  dependencies.onAttemptReceipts?.(attempts);
  await (dependencies.recordProviderRun ?? recordAdStudioProviderRun)({
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
      assetReferences: contact.assetReferences,
      independentConfirmationRequested: confirmationRequested,
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
  if (!finalReview) {
    throw new TemplateCampaignQaError(
      finalError instanceof Error ? finalError.message : "Clone quality review failed.",
      undefined,
      {
        // Only malformed schema output and provider-declared recoverable
        // transport failures can recheck this exact image. A valid review
        // (including a low score) never reaches this path.
        aborted: isAbortError(finalError),
        cause: finalError,
      },
    );
  }

  const bindingMatches = finalReview.templateId === input.templateId
    && finalReview.format === input.format
    && finalReview.attempt === input.attempt
    && finalReview.referenceHash === contact.referenceHash
    && finalReview.candidateHash === contact.candidateHash
    && finalReview.requestHash === requestHash;
  if (!bindingMatches) throw new TemplateCampaignQaError("Clone quality review was not bound to this exact candidate.");
  return finalReview;
}
