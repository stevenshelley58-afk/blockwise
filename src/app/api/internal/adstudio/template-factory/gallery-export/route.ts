import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  TEMPLATE_FACTORY_EXPORT_SCHEMA,
  bytesHash,
  canonicalHash,
  canonicalJson,
  fetchVerifiedPullImage,
  safeBearerMatches,
  validatePullReceipt,
  validateReleaseAttestation,
  type TemplateFactoryExportBody,
} from "@/lib/adstudio/template-factory-contract";
import {
  claimPullReceipts,
  deleteFactoryArtifact,
  loadFactoryCandidate,
  loadFactoryReleaseByCandidate,
  loadFactoryReleaseByRequest,
  persistFactoryRelease,
  resolveTemplateFactoryConfig,
  uploadFactoryArtifact,
} from "@/lib/adstudio/template-factory-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let config: ReturnType<typeof resolveTemplateFactoryConfig>;
  try { config = resolveTemplateFactoryConfig(); }
  catch { return NextResponse.json({ error: "Template factory is unavailable." }, { status: 503 }); }
  if (!safeBearerMatches(request.headers.get("authorization"), config.serviceToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null) as TemplateFactoryExportBody | null;
    if (!body || body.schema !== TEMPLATE_FACTORY_EXPORT_SCHEMA) throw new Error("Gallery export schema is invalid.");
    validateReleaseAttestation(body);
    const exportIntentHash = canonicalHash({
      factoryJobId: body.factoryJobId,
      candidateId: body.candidateId,
      manifestHash: body.manifestHash,
      attestationHash: body.attestation.attestationHash,
    });
    if (body.requestId !== exportIntentHash || request.headers.get("idempotency-key") !== body.requestId) {
      return NextResponse.json({ error: "Gallery export request ID does not match its immutable release intent." }, { status: 409 });
    }
    const requestHash = canonicalHash(body);
    const existing = await loadFactoryReleaseByRequest({ config, factoryJobId: body.factoryJobId, requestId: body.requestId });
    if (existing) {
      if (existing.request_hash === requestHash) return NextResponse.json({ releaseId: existing.id, receiptId: existing.id, requestId: body.requestId });
      return NextResponse.json({ error: "The gallery export request ID is already bound to different inputs." }, { status: 409 });
    }
    const priorCandidateRelease = await loadFactoryReleaseByCandidate({ config, factoryJobId: body.factoryJobId, candidateId: body.candidateId });
    if (priorCandidateRelease) {
      if (priorCandidateRelease.request_hash === requestHash
        || (priorCandidateRelease.manifest_hash === body.manifestHash && priorCandidateRelease.attestation_hash === body.attestation.attestationHash)) {
        return NextResponse.json({ releaseId: priorCandidateRelease.id, receiptId: priorCandidateRelease.id, requestId: body.requestId });
      }
      return NextResponse.json({ error: "The staged candidate is already bound to a different gallery export." }, { status: 409 });
    }
    const candidate = await loadFactoryCandidate({ config, candidateId: body.candidateId, factoryJobId: body.factoryJobId });
    if (!candidate || Date.parse(String(candidate.expires_at)) <= Date.now()) throw new Error("The staged candidate is missing or expired.");
    const attestation = body.attestation;
    const exactBindings: Array<[unknown, unknown]> = [
      [candidate.source_hash, attestation.sourceHash],
      [candidate.sample_hash, attestation.sampleHash],
      [candidate.safe_text_hash, attestation.safeTextHash],
      [candidate.clone_request_hash, attestation.cloneRequestHash],
      [candidate.qa_hash, attestation.qaHash],
      [candidate.evidence_hash, attestation.evidenceHash],
      [candidate.sample_hash, body.samplePull.contentHash],
      [candidate.template_id, body.manifest.id],
      [candidate.source_hash, (body.manifest.sourceAd as { contentHash?: unknown } | undefined)?.contentHash],
      [candidate.sample_hash, (body.manifest.sample as { contentHash?: unknown } | undefined)?.contentHash],
    ];
    if (exactBindings.some(([left, right]) => left !== right)) throw new Error("Gallery export does not match the staged candidate.");
    validatePullReceipt(body.samplePull, config.pullOrigin, Date.now(), config.pullPathPrefix);
    if (!await claimPullReceipts({ config, factoryJobId: body.factoryJobId, requestId: body.requestId, receipts: [body.samplePull] })) {
      return NextResponse.json({ error: "The approved sample pull receipt was already used." }, { status: 409 });
    }
    const sample = await fetchVerifiedPullImage({
      receipt: body.samplePull,
      allowedOrigin: config.pullOrigin,
      allowedPathPrefix: config.pullPathPrefix,
      pullBearer: config.pullToken,
      claim: async () => true,
    });
    if (bytesHash(sample.bytes) !== candidate.sample_hash) throw new Error("Approved sample bytes do not match the staged candidate.");
    const releaseId = randomUUID();
    const bundle = {
      schema: "adstudio.template.release-bundle.v1",
      releaseId,
      candidateId: body.candidateId,
      factoryJobId: body.factoryJobId,
      requestId: body.requestId,
      manifest: body.manifest,
      manifestHash: body.manifestHash,
      sample: { contentType: sample.contentType, contentHash: candidate.sample_hash, base64: Buffer.from(sample.bytes).toString("base64") },
      evidence: candidate.evidence_json,
      qa: candidate.qa_json,
      attempts: candidate.attempts_json,
      attestation: body.attestation,
    };
    const bundleBytes = Buffer.from(canonicalJson(bundle), "utf8");
    const stored = await uploadFactoryArtifact({ config, category: "releases", id: releaseId, bytes: bundleBytes, contentType: "application/json", extension: "json" });
    try {
      await persistFactoryRelease({
        config, releaseId, candidateId: body.candidateId, factoryJobId: body.factoryJobId, requestId: body.requestId,
        requestHash, manifestHash: body.manifestHash, attestationHash: body.attestation.attestationHash,
        sampleHash: candidate.sample_hash, bundleHash: stored.contentHash, storagePath: stored.storagePath,
      });
    } catch (error) {
      await deleteFactoryArtifact(stored.storagePath);
      throw error;
    }
    return NextResponse.json({ releaseId, receiptId: releaseId, requestId: body.requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gallery export failed.";
    const status = /schema|invalid|match|expired|missing|receipt|approval|attestation|manifest/iu.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
