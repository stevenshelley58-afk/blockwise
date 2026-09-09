import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  cloneCorrectionForNextCandidate,
  cloneQualityPassed,
  cloneRequestHash,
  reviewCloneCandidate,
} from "@/lib/adstudio/clone-quality-gate";
import {
  cloneModelProfileForQuality,
  CloneGenerationError,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  resolveCloneProviders,
} from "@/lib/adstudio/clone-generation";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { buildCloneImageRequest } from "@/lib/adstudio/reference-clone";
import type { AdStudioTemplate } from "@/lib/adstudio/templates";
import {
  TEMPLATE_FACTORY_CLONE_SCHEMA,
  TEMPLATE_FACTORY_RECEIPT_TTL_MS,
  buildCandidateEvidence,
  bytesHash,
  canonicalHash,
  fetchVerifiedPullImage,
  safeBearerMatches,
  validateExactInputKeys,
  validatePullReceipt,
  type TemplateFactoryCloneBody,
  type TemplateFactoryDraft,
} from "@/lib/adstudio/template-factory-contract";
import {
  beginFactoryClone,
  claimPullReceipts,
  createFactoryReceipt,
  deleteFactoryArtifact,
  finishFactoryClone,
  loadFactoryCandidateByRequest,
  persistFactoryCandidate,
  resolveTemplateFactoryConfig,
  uploadFactoryArtifact,
} from "@/lib/adstudio/template-factory-storage";
import type { ProviderRunAttempt } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let responseRequestId = request.headers.get("x-request-id")?.slice(0, 128) ?? "unknown";
  const attempts: Array<Record<string, unknown>> = [];
  let config: ReturnType<typeof resolveTemplateFactoryConfig>;
  let ledgerContext: { factoryJobId: string; requestId: string } | null = null;
  let providerStarted = false;
  let ledgerFinalized = false;
  try { config = resolveTemplateFactoryConfig(); }
  catch { return NextResponse.json({ error: "Template factory is unavailable." }, { status: 503 }); }
  if (!safeBearerMatches(request.headers.get("authorization"), config.serviceToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await parseCloneBody(request);
    responseRequestId = body.requestId;
    validateExactInputKeys(body);
    const allReceipts = [body.sourceReference, ...body.draft.inputs.images.map((input) => body.genericImages[input.key]!)];
    for (const receipt of allReceipts) validatePullReceipt(receipt, config.pullOrigin, Date.now(), config.pullPathPrefix);
    const genericImageHashes = Object.fromEntries(body.draft.inputs.images.map((input) => [input.key, body.genericImages[input.key]!.contentHash]));
    const inputsHash = canonicalHash({ inputs: body.draft.inputs, safeText: body.safeText, genericImageHashes });
    const intentHash = canonicalHash({
      schema: "adstudio.template.clone-intent.v1",
      factoryJobId: body.factoryJobId,
      templateId: body.draft.id,
      sourceHash: body.sourceReference.contentHash,
      inputsHash,
    });
    if (body.requestId !== intentHash) {
      return NextResponse.json({ error: "Factory request ID does not match its immutable clone intent.", requestId: body.requestId, attempts, retryDisposition: "intent_conflict" }, { status: 409 });
    }
    const ledger = await beginFactoryClone({ config, factoryJobId: body.factoryJobId, requestId: body.requestId, intentHash });
    ledgerContext = { factoryJobId: body.factoryJobId, requestId: body.requestId };
    if (ledger.disposition === "intent_conflict") {
      return NextResponse.json({ error: "The factory request ID is already bound to different immutable inputs.", requestId: body.requestId, attempts, retryDisposition: "intent_conflict" }, { status: 409 });
    }
    if (ledger.disposition === "replay") {
      const existing = await loadFactoryCandidateByRequest({ config, factoryJobId: body.factoryJobId, requestId: body.requestId });
      if (existing?.request_hash === intentHash && Date.parse(String(existing.expires_at)) > Date.now()) {
        return NextResponse.json(await existingCandidateResponse({ config, body, existing }));
      }
      const stored = ledger.response as { statusCode?: unknown; body?: unknown } | null;
      if (stored && Number.isInteger(stored.statusCode) && stored.body && typeof stored.body === "object") {
        return NextResponse.json(stored.body, { status: Number(stored.statusCode) });
      }
      return NextResponse.json({
        error: ledger.status === "running" ? "This clone intent is already in progress; it will not be dispatched twice." : "This clone intent has an ambiguous prior provider outcome and cannot be redispatched.",
        requestId: body.requestId, attempts, retryDisposition: "do_not_redispatch", outcome: "in_progress_or_ambiguous",
      }, { status: 409 });
    }
    if (!await claimPullReceipts({ config, factoryJobId: body.factoryJobId, requestId: body.requestId, receipts: allReceipts })) {
      const failure = { error: "A pull receipt was already used or duplicated.", requestId: body.requestId, attempts, retryDisposition: "retryable_fresh_pulls" };
      await finishFactoryClone({ config, ...ledgerContext, status: "retryable", response: { statusCode: 503, body: failure } });
      ledgerFinalized = true;
      return NextResponse.json(failure, { status: 503 });
    }
    const pull = (receipt: typeof body.sourceReference) => fetchVerifiedPullImage({
      receipt,
      allowedOrigin: config.pullOrigin,
      pullBearer: config.pullToken,
      allowedPathPrefix: config.pullPathPrefix,
      claim: async () => true,
    });
    const [source, ...genericAssets] = await Promise.all([
      pull(body.sourceReference),
      ...body.draft.inputs.images.map((input) => pull(body.genericImages[input.key]!)),
    ]);
    const images = Object.fromEntries(body.draft.inputs.images.map((input, index) => [input.key, genericAssets[index]!.dataUrl]));
    const template = inMemoryFactoryTemplate(body.draft, source.dataUrl);
    const expectedAssetKeys = body.draft.inputs.images.map((input) => input.key);
    const candidateId = randomUUID();
    const providers = await resolveCloneProviders("high");
    let correction = "";
    let finalDataUrl = "";
    let finalReview: Awaited<ReturnType<typeof reviewCloneCandidate>> | null = null;
    let finalRequestHash = "";

    for (let candidateAttempt = 1; candidateAttempt <= 3; candidateAttempt += 1) {
      const cloneRequest = buildCloneImageRequest(template, {
        referenceImage: source.dataUrl,
        images,
        copy: body.safeText,
        aspectRatio: body.draft.format,
        reviewCorrection: correction || undefined,
      });
      if (cloneRequest.referenceAssets[0] !== source.dataUrl) throw new Error("Private source was not reference image 1.");
      let generated: Awaited<ReturnType<typeof generateCloneWithCascade>>;
      const cloneAttempts: ProviderRunAttempt[] = [];
      try {
        providerStarted = true;
        generated = await generateCloneWithCascade({
          providers,
          request: cloneRequest,
          workspaceId: config.accountingWorkspaceId,
          userId: config.accountingUserId,
          correlationId: `${body.factoryJobId}:${body.requestId}`,
          attempt: candidateAttempt,
          modelProfile: cloneModelProfileForQuality("high"),
          onAttemptReceipts: (items) => cloneAttempts.push(...items),
        });
      } catch (error) {
        const receipts = cloneAttempts.length ? cloneAttempts : error instanceof CloneGenerationError ? error.attemptReceipts : [];
        attempts.push(...safeAttemptReceipts("reference_clone", candidateAttempt, receipts));
        throw error;
      }
      attempts.push(...safeAttemptReceipts("reference_clone", candidateAttempt, cloneAttempts.length ? cloneAttempts : generated.attemptReceipts ?? []));
      const candidate = await normalizeCloneRenderAspect(generated.assetUrl, body.draft.format);
      const qaAttempts: ProviderRunAttempt[] = [];
      let review: Awaited<ReturnType<typeof reviewCloneCandidate>>;
      try {
        review = await reviewCloneCandidate({
          templateId: body.draft.id,
          format: body.draft.format,
          attempt: candidateAttempt,
          referenceImage: source.dataUrl,
          candidateImage: candidate,
          request: cloneRequest,
          expectedCopy: body.safeText,
          expectedAssetKeys,
          workspaceId: config.accountingWorkspaceId,
          userId: config.accountingUserId,
          correlationId: `${body.factoryJobId}:${body.requestId}`,
        }, { onAttemptReceipts: (items) => qaAttempts.push(...items) });
      } catch (error) {
        attempts.push(...safeAttemptReceipts("visual_qa", candidateAttempt, qaAttempts));
        throw error;
      }
      const passed = cloneQualityPassed({ review, expectedCopy: body.safeText, expectedAssetKeys });
      attempts.push(...safeAttemptReceipts("visual_qa", candidateAttempt, qaAttempts, passed));
      if (passed) {
        finalDataUrl = candidate;
        finalReview = review;
        finalRequestHash = cloneRequestHash(cloneRequest);
        break;
      }
      correction = cloneCorrectionForNextCandidate(review);
    }
    if (!finalReview || !finalDataUrl) {
      const failure = { error: "Candidate did not pass clone quality gates.", requestId: body.requestId, attempts, retryDisposition: "terminal" };
      await finishFactoryClone({ config, ...ledgerContext, status: "terminal", response: { statusCode: 422, body: failure } });
      ledgerFinalized = true;
      return NextResponse.json(failure, { status: 422 });
    }
    const sample = dataUrlToUploadBytes(finalDataUrl);
    if (sample.contentType !== "image/png" || sample.bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => sample.bytes[index] === value)) {
      throw new Error("Candidate output is not a valid PNG.");
    }
    const sampleHash = bytesHash(sample.bytes);
    if (sampleHash === body.sourceReference.contentHash) throw new Error("Public sample must differ from the private source.");
    const safeTextHash = canonicalHash(body.safeText);
    const canonicalQa = publicQa(finalReview);
    if (!canonicalQa.passed) throw new Error("Candidate public QA evidence is inconsistent with the quality gate.");
    assertSuccessfulAttempts(attempts);
    const qaHash = canonicalHash(canonicalQa);
    const attemptReceiptsHash = canonicalHash(attempts);
    const { evidence, evidenceHash } = buildCandidateEvidence({
      factoryJobId: body.factoryJobId,
      requestId: body.requestId,
      candidateId,
      templateId: body.draft.id,
      sourceHash: body.sourceReference.contentHash,
      sampleHash,
      safeTextHash,
      genericImageHashes,
      inputsHash,
      cloneRequestHash: finalRequestHash,
      qaHash,
      attemptsHash: attemptReceiptsHash,
    });
    const receiptExpiresAt = new Date(Date.now() + TEMPLATE_FACTORY_RECEIPT_TTL_MS).toISOString();
    const candidateExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const stored = await uploadFactoryArtifact({ config, category: "candidates", id: candidateId, bytes: sample.bytes, contentType: sample.contentType, extension: "png" });
    if (stored.contentHash !== sampleHash) throw new Error("Stored candidate hash mismatch.");
    try {
      await persistFactoryCandidate({
        config, candidateId, factoryJobId: body.factoryJobId, requestId: body.requestId, requestHash: intentHash,
        templateId: body.draft.id, sourceHash: body.sourceReference.contentHash, sampleHash, safeTextHash,
        cloneRequestHash: finalRequestHash, qaHash, evidenceHash, storagePath: stored.storagePath,
        evidence, qa: canonicalQa, attempts, expiresAt: candidateExpiresAt,
      });
    } catch (error) {
      await deleteFactoryArtifact(stored.storagePath);
      throw error;
    }
    await finishFactoryClone({ config, ...ledgerContext, status: "succeeded" });
    ledgerFinalized = true;
    const image = await createFactoryReceipt({
      config, factoryJobId: body.factoryJobId, requestId: body.requestId,
      kind: "candidate_png", candidateId, storagePath: stored.storagePath, contentHash: sampleHash, expiresAt: receiptExpiresAt,
    });
    return NextResponse.json(candidateResponse({
      templateId: body.draft.id, candidateId, image, qa: canonicalQa, cloneRequestHash: finalRequestHash,
      requestId: body.requestId, attempts, sourceHash: body.sourceReference.contentHash, sampleHash,
      safeTextHash, qaHash, evidenceHash,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template factory request failed.";
    const invalid = /malformed|invalid|match|expired|lifetime|origin|required|keys|dimensions|schema|format/iu.test(message);
    const retryDisposition = ledgerFinalized ? "retryable_fresh_pulls" : providerStarted ? "do_not_redispatch" : ledgerContext ? "retryable_fresh_pulls" : "terminal";
    const status = ledgerFinalized ? 503 : providerStarted ? 409 : invalid ? 400 : 503;
    const publicMessage = ledgerFinalized
      ? "The candidate is durably staged but its pull receipt could not be issued; retry the same clone intent."
      : providerStarted
        ? "The provider outcome is ambiguous; this clone intent was quarantined without redispatch."
        : ledgerContext && !invalid
          ? "Clone preparation failed before provider dispatch; retry with fresh pull receipts."
          : message;
    const body = {
      error: publicMessage, requestId: responseRequestId, attempts, retryDisposition,
      ...(providerStarted && !ledgerFinalized ? { outcome: "in_progress_or_ambiguous" } : {}),
    };
    if (ledgerContext && !ledgerFinalized) {
      try {
        await finishFactoryClone({
          config, ...ledgerContext, status: providerStarted ? "ambiguous" : "retryable",
          response: { statusCode: status, body },
        });
      } catch {
        return NextResponse.json({ error: "Clone outcome could not be durably recorded; redispatch is forbidden.", requestId: responseRequestId, attempts, retryDisposition: "do_not_redispatch", outcome: "in_progress_or_ambiguous" }, { status: 409 });
      }
    }
    return NextResponse.json(body, { status });
  }
}

async function existingCandidateResponse(input: {
  config: ReturnType<typeof resolveTemplateFactoryConfig>;
  body: TemplateFactoryCloneBody;
  existing: Record<string, any>;
}) {
  const expiresAt = new Date(Date.now() + TEMPLATE_FACTORY_RECEIPT_TTL_MS).toISOString();
  const image = await createFactoryReceipt({
    config: input.config, factoryJobId: input.body.factoryJobId, requestId: input.body.requestId, kind: "candidate_png",
    candidateId: input.existing.id, storagePath: input.existing.storage_path, contentHash: input.existing.sample_hash, expiresAt,
  });
  return candidateResponse({
    templateId: input.existing.template_id, candidateId: input.existing.id, sourceHash: input.existing.source_hash,
    sampleHash: input.existing.sample_hash, safeTextHash: input.existing.safe_text_hash, image,
    qa: publicQa(input.existing.qa_json), cloneRequestHash: input.existing.clone_request_hash, qaHash: input.existing.qa_hash,
    evidenceHash: input.existing.evidence_hash, requestId: input.body.requestId,
    attempts: Array.isArray(input.existing.attempts_json) ? input.existing.attempts_json : [],
  });
}

async function parseCloneBody(request: NextRequest): Promise<TemplateFactoryCloneBody> {
  const body = await request.json().catch(() => null) as TemplateFactoryCloneBody | null;
  if (!body || body.schema !== TEMPLATE_FACTORY_CLONE_SCHEMA || body.purpose !== "public_sample") throw new Error("Clone request schema is invalid.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(body.factoryJobId) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(body.requestId)) throw new Error("Factory job or request ID is invalid.");
  if (!body.draft || !/^[a-z0-9][a-z0-9-]{2,79}$/u.test(body.draft.id) || !body.draft.name?.trim()) throw new Error("Template draft is malformed.");
  if (!body.sourceReference || !body.genericImages || typeof body.genericImages !== "object" || Array.isArray(body.genericImages) || !body.safeText || typeof body.safeText !== "object" || Array.isArray(body.safeText)) throw new Error("Clone inputs are malformed.");
  if (!Array.isArray(body.draft.inputs?.images) || !Array.isArray(body.draft.inputs?.text)) throw new Error("Declared template inputs are malformed.");
  if (body.draft.inputs.images.length < 1 || body.draft.inputs.images.length > 8 || body.draft.inputs.text.length > 20
    || body.draft.inputs.images.some((input) => !input || typeof input.key !== "string" || !input.label?.trim() || !input.description?.trim()
      || typeof input.required !== "boolean" || (input.aspect !== undefined && !["landscape", "portrait", "square"].includes(input.aspect)))
    || body.draft.inputs.text.some((input) => !input || typeof input.key !== "string" || !input.label?.trim()
      || typeof input.required !== "boolean" || !Number.isInteger(input.maxLength) || input.maxLength < 1 || input.maxLength > 1_000
      || typeof input.sample !== "string" || input.sample.length > input.maxLength)) {
    throw new Error("Declared template inputs are malformed.");
  }
  if (!(["4:5", "9:16"] as string[]).includes(body.draft.format)) throw new Error("Template format is invalid.");
  const requiredDimensions = body.draft.format === "4:5" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
  if (body.draft.dimensions?.width !== requiredDimensions.width || body.draft.dimensions?.height !== requiredDimensions.height) throw new Error("Template dimensions do not match its format.");
  const classification = body.draft.classification;
  if (!classification || !classification.ad_type?.trim() || !classification.primary_intent?.trim() || !["property", "agent", "both"].includes(classification.property_or_agent_focus)) throw new Error("Template classification is invalid.");
  const sourceFile = body.draft.sourceAd?.file;
  if (sourceFile && (/^(?:[a-z]+:|\/|\\)/iu.test(sourceFile) || sourceFile.includes("..") || sourceFile.includes("\\"))) throw new Error("Source file provenance is invalid.");
  if (!sourceFile && !body.draft.sourceAd?.creativeId?.trim()) throw new Error("Source file or creative ID provenance is required.");
  if (body.sourceReference.contentHash !== body.draft.sourceAd?.contentHash) throw new Error("Source hash does not match the draft.");
  return body;
}

function inMemoryFactoryTemplate(draft: TemplateFactoryDraft, referenceImage: string): AdStudioTemplate {
  return {
    ...draft,
    audienceIntent: String(draft.classification.primary_intent ?? "real estate leads"),
    category: String(draft.classification.ad_type ?? "lead_generation"),
    goal: "buyer_leads",
    offerId: `factory-${draft.id}`,
    source: "builtin",
    status: "approved",
    tags: [],
    sample: { imageSrc: referenceImage, thumbnailSrc: referenceImage, alt: draft.name, generatedBy: "reference_clone", contentHash: draft.sourceAd.contentHash },
    sourceAd: { contentHash: draft.sourceAd.contentHash, provenance: "frank_factory" },
    meta: {
      platform: "meta", objective: "OUTCOME_LEADS", specialAdCategory: "housing",
      primaryText: ["Request more information."], headlines: [draft.name], descriptions: ["Request more information."], cta: "LEARN_MORE",
      publisherPlatforms: ["facebook", "instagram"], facebookPositions: ["feed"], instagramPositions: ["stream"],
      leadForm: { headline: "Request more information", questions: [], privacyPolicyUrl: null, thankYouScreen: { title: "Request received", body: "The agency will be in touch shortly." } },
    },
  } as unknown as AdStudioTemplate;
}

function safeAttemptReceipts(stage: "reference_clone" | "visual_qa", candidateAttempt: number, attempts: readonly ProviderRunAttempt[], qaPassed?: boolean) {
  return attempts.map((attempt) => ({
    stage,
    providerId: attempt.provider,
    modelRef: attempt.model,
    receiptId: attempt.providerRequestId ?? null,
    costUsd: formatCost(attempt.actualCostUsd ?? attempt.estimatedCostUsd),
    outcome: attempt.status === "failed" ? "error" : qaPassed === false ? "fail" : "pass",
    detail: `${stage === "reference_clone" ? "Reference clone" : "Visual QA"} attempt ${candidateAttempt}.${attempt.attemptIndex + 1} ${attempt.status === "failed" ? "failed" : qaPassed === false ? "rejected the candidate" : "completed"}.`,
  }));
}

function assertSuccessfulAttempts(attempts: Array<Record<string, unknown>>): void {
  const stages = ["reference_clone", "visual_qa"] as const;
  for (const stage of stages) {
    if (!attempts.some((attempt) => attempt.stage === stage && attempt.outcome === "pass")) {
      throw new Error(`Successful factory response is missing a passing ${stage} attempt receipt.`);
    }
  }
  for (const attempt of attempts) {
    if (!stages.includes(attempt.stage as typeof stages[number])
      || typeof attempt.providerId !== "string" || !attempt.providerId
      || typeof attempt.modelRef !== "string" || !attempt.modelRef
      || !(attempt.receiptId === null || typeof attempt.receiptId === "string")
      || typeof attempt.costUsd !== "string" || !/^\d+(?:\.\d{1,8})?$/u.test(attempt.costUsd)
      || !["pass", "fail", "error"].includes(String(attempt.outcome))
      || typeof attempt.detail !== "string" || !attempt.detail) {
      throw new Error("Successful factory response contains malformed paid-attempt evidence.");
    }
  }
}

function formatCost(value: number): string {
  return Math.max(0, Number.isFinite(value) ? value : 0).toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

type PublicFactoryQa = {
  passed: boolean;
  likenessScore?: number;
  qualityScore?: number;
  failures: string[];
  copyChecks: Array<{ key: string; expected: string; observed: string; exact: boolean }>;
  assetChecks: Array<{ key: string; used: boolean; faithful: boolean; notes: string }>;
  excludedContentInfluencedScore: boolean;
  identityLeakage: string[];
  defects: string[];
};

function publicQa(review: unknown): PublicFactoryQa {
  const value = review as {
    passed?: unknown; likenessScore?: unknown; qualityScore?: unknown; failures?: unknown;
    adSystemLikenessScore?: unknown; standaloneAdQualityScore?: unknown; excludedContentInfluencedScore?: unknown;
    copyChecks?: unknown; assetChecks?: unknown; defects?: unknown; identityLeakage?: unknown;
  };
  const copyChecks = Array.isArray(value?.copyChecks) ? value.copyChecks.flatMap((item) => {
    const check = item as { key?: unknown; expected?: unknown; rendered?: unknown; observed?: unknown };
    const observed = typeof check.observed === "string" ? check.observed : typeof check.rendered === "string" ? check.rendered : null;
    if (typeof check.key !== "string" || typeof check.expected !== "string" || observed === null) return [];
    return [{ key: check.key, expected: check.expected, observed, exact: visibleQaText(observed) === visibleQaText(check.expected) }];
  }) : [];
  const assetChecks = Array.isArray(value?.assetChecks) ? value.assetChecks.flatMap((item) => {
    const check = item as { key?: unknown; used?: unknown; faithful?: unknown; notes?: unknown };
    if (typeof check.key !== "string" || typeof check.used !== "boolean" || typeof check.faithful !== "boolean") return [];
    return [{ key: check.key, used: check.used, faithful: check.faithful, notes: typeof check.notes === "string" ? check.notes : "" }];
  }) : [];
  const likenessScore = typeof value?.adSystemLikenessScore === "number" ? value.adSystemLikenessScore : undefined;
  const qualityScore = typeof value?.standaloneAdQualityScore === "number" ? value.standaloneAdQualityScore : undefined;
  const publicLikeness = likenessScore ?? (typeof value?.likenessScore === "number" ? value.likenessScore : undefined);
  const publicQuality = qualityScore ?? (typeof value?.qualityScore === "number" ? value.qualityScore : undefined);
  const identityLeakage = Array.isArray(value?.identityLeakage) ? value.identityLeakage.filter((item): item is string => typeof item === "string") : [];
  const defects = Array.isArray(value?.defects) ? value.defects.filter((item): item is string => typeof item === "string") : [];
  const failures = Array.isArray(value?.failures)
    ? value.failures.filter((item): item is string => typeof item === "string")
    : [...identityLeakage, ...defects];
  const excludedContentInfluencedScore = value?.excludedContentInfluencedScore === false ? false : true;
  const evidencePassed = failures.length === 0
    && identityLeakage.length === 0
    && defects.length === 0
    && excludedContentInfluencedScore === false
    && copyChecks.every((check) => check.exact)
    && assetChecks.every((check) => check.used && check.faithful)
    && (publicLikeness ?? 0) >= 9.5
    && (publicQuality ?? 0) >= 9;
  return {
    passed: typeof value?.passed === "boolean" ? value.passed && evidencePassed : evidencePassed,
    ...(publicLikeness !== undefined ? { likenessScore: publicLikeness } : {}),
    ...(publicQuality !== undefined ? { qualityScore: publicQuality } : {}),
    failures,
    copyChecks,
    assetChecks,
    excludedContentInfluencedScore,
    identityLeakage,
    defects,
  };
}

function visibleQaText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function candidateResponse(value: Record<string, unknown>) {
  return value;
}
