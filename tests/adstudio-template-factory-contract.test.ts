import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TEMPLATE_FACTORY_APPROVAL_CONFIRMATION,
  TEMPLATE_FACTORY_ATTESTATION_SCHEMA,
  TEMPLATE_FACTORY_EXPORT_SCHEMA,
  buildCandidateEvidence,
  bytesHash,
  canonicalHash,
  canonicalJson,
  fetchVerifiedPullImage,
  safeBearerMatches,
  validatePullReceipt,
  validateReleaseAttestation,
  type TemplateFactoryExportBody,
} from "../src/lib/adstudio/template-factory-contract.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const now = Date.parse("2026-08-11T12:00:00.000Z");

function pullReceipt(contentHash = bytesHash(png)) {
  return {
    url: "https://frank.example/internal/factory-pulls/one-use",
    contentHash,
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function exportBody(): TemplateFactoryExportBody {
  const manifest = {
    id: "meta-factory-feed-001",
    name: "Factory Feed",
    format: "4:5",
    dimensions: { width: 1080, height: 1350 },
    classification: { ad_type: "lead_generation", primary_intent: "buyer_leads", property_or_agent_focus: "property" },
    inputs: {
      images: [{ key: "property_photo", label: "Property photo", description: "Customer property", required: true }],
      text: [{ key: "headline", label: "Headline", maxLength: 40, required: true, sample: "Find your next home" }],
    },
    sourceAd: { contentHash: "a".repeat(64), provenance: "frank_factory" },
    sample: {
      imageSrc: "/adstudio-samples/meta/meta-factory-feed-001-v1.png",
      thumbnailSrc: "/adstudio-samples/meta/meta-factory-feed-001-v1.png",
      alt: "Generated public sample.", contentHash: bytesHash(png), generatedBy: "reference_clone",
    },
    typography: { headline: { fontFile: "/fonts/adstudio/manrope-800.woff2" } },
  };
  const manifestHash = canonicalHash(manifest);
  const approval = {
    reviewerId: "reviewer-1", reviewedAt: "2026-08-11T11:59:00.000Z", reviewSessionId: "session-1",
    confirmation: TEMPLATE_FACTORY_APPROVAL_CONFIRMATION,
  } as const;
  const unsigned = {
    schema: TEMPLATE_FACTORY_ATTESTATION_SCHEMA,
    factoryJobId: "job-1", candidateId: "fd607771-ce8c-4de6-a376-bb4033525834",
    sourceHash: "a".repeat(64), sampleHash: bytesHash(png), safeTextHash: "b".repeat(64),
    cloneRequestHash: "c".repeat(64), qaHash: "d".repeat(64), evidenceHash: "e".repeat(64), manifestHash,
    approval, approvalHash: canonicalHash(approval),
  };
  return {
    schema: TEMPLATE_FACTORY_EXPORT_SCHEMA, factoryJobId: "job-1", requestId: canonicalHash({
      factoryJobId: "job-1", candidateId: unsigned.candidateId, manifestHash, attestationHash: canonicalHash(unsigned),
    }),
    candidateId: unsigned.candidateId, manifest, manifestHash, samplePull: pullReceipt(),
    attestation: { ...unsigned, attestationHash: canonicalHash(unsigned) },
  } as TemplateFactoryExportBody;
}

test("canonical hashing recursively sorts object keys and omits undefined", () => {
  assert.equal(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, skip: undefined }), '{"nested":{"a":1,"b":2},"z":1}');
  assert.equal(canonicalHash({ b: 2, a: 1 }), createHash("sha256").update('{"a":1,"b":2}').digest("hex"));
});

test("bearer comparison and pull receipt validation fail closed", () => {
  assert.equal(safeBearerMatches("Bearer service-a", "service-a"), true);
  assert.equal(safeBearerMatches("Bearer service-b", "service-a"), false);
  assert.throws(() => validatePullReceipt({ ...pullReceipt(), url: "https://user:pass@frank.example/internal/factory-pulls/one-use" }, "https://frank.example", now, "/internal/factory-pulls"), /origin/u);
  assert.throws(() => validatePullReceipt({ ...pullReceipt(), url: "https://frank.example/other/one-use" }, "https://frank.example", now, "/internal/factory-pulls"), /path/u);
  assert.throws(() => validatePullReceipt({ ...pullReceipt(), expiresAt: new Date(now + 6 * 60_000).toISOString() }, "https://frank.example", now, "/internal/factory-pulls"), /lifetime/u);
});

test("verified pull enforces one-use claim, MIME magic, hash, streamed limit, and timeout", async () => {
  const common = { receipt: pullReceipt(), allowedOrigin: "https://frank.example", allowedPathPrefix: "/internal/factory-pulls", pullBearer: "pull-secret", now };
  let headers: HeadersInit | undefined;
  const success = await fetchVerifiedPullImage({
    ...common, claim: async () => true,
    fetchImpl: async (_url, init) => { headers = init?.headers; return new Response(png, { headers: { "content-type": "image/png" } }); },
  });
  assert.deepEqual(success.bytes, png);
  assert.deepEqual(headers, { authorization: "Bearer pull-secret" });
  await assert.rejects(fetchVerifiedPullImage({ ...common, claim: async () => false, fetchImpl: async () => new Response(png) }), /already used/u);
  await assert.rejects(fetchVerifiedPullImage({ ...common, claim: async () => true, fetchImpl: async () => new Response(png, { headers: { "content-type": "image/jpeg" } }) }), /MIME/u);
  const chunks = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png.slice(0, 8)); controller.enqueue(png.slice(8)); controller.close(); } });
  await assert.rejects(fetchVerifiedPullImage({ ...common, claim: async () => true, maxBytes: 10, fetchImpl: async () => new Response(chunks, { headers: { "content-type": "image/png" } }) }), /size limit/u);
  await assert.rejects(fetchVerifiedPullImage({
    ...common, claim: async () => true, timeoutMs: 5,
    fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
  }), /could not be fetched/u);
});

test("candidate evidence binds the exact inputs and public QA shape used by Frank", () => {
  const qa = { passed: true, likenessScore: 9.7, qualityScore: 9.4, failures: [] as string[] };
  const genericImageHashes = { property_photo: "f".repeat(64) };
  const inputs = { images: [{ key: "property_photo" }], text: [{ key: "headline" }] };
  const safeText = { headline: "Find your next home" };
  const result = buildCandidateEvidence({
    factoryJobId: "job-1", requestId: "request-1", candidateId: "candidate-1", templateId: "template-1",
    sourceHash: "a".repeat(64), sampleHash: "b".repeat(64), safeTextHash: canonicalHash(safeText), genericImageHashes,
    inputsHash: canonicalHash({ inputs, safeText, genericImageHashes }), cloneRequestHash: "c".repeat(64),
    qaHash: canonicalHash(qa), attemptsHash: canonicalHash([]),
  });
  assert.equal(result.evidence.qaHash, canonicalHash(qa));
  assert.equal(result.evidence.inputsHash, canonicalHash({ inputs, safeText, genericImageHashes }));
  assert.equal(result.evidenceHash, canonicalHash(result.evidence));
});

test("release attestation accepts only a source-free flat gallery manifest", () => {
  const body = exportBody();
  assert.doesNotThrow(() => validateReleaseAttestation(body));
  const privateSource = exportBody();
  privateSource.manifest.sourceAd = {
    ...(privateSource.manifest.sourceAd as object),
    file: "01_feed/source.png",
  };
  privateSource.manifestHash = canonicalHash(privateSource.manifest);
  privateSource.attestation.manifestHash = privateSource.manifestHash;
  const { attestationHash: _privateHash, ...privateUnsigned } = privateSource.attestation;
  privateSource.attestation.attestationHash = canonicalHash(privateUnsigned);
  assert.throws(() => validateReleaseAttestation(privateSource), /source-free|forbidden field file/u);
  const layered = structuredClone(body);
  layered.manifest.layers = [];
  layered.manifestHash = canonicalHash(layered.manifest);
  layered.attestation.manifestHash = layered.manifestHash;
  const { attestationHash: _old, ...unsigned } = layered.attestation;
  layered.attestation.attestationHash = canonicalHash(unsigned);
  assert.throws(() => validateReleaseAttestation(layered), /forbidden field layers/u);
  const external = exportBody();
  external.manifest.sample = { ...(external.manifest.sample as object), imageSrc: "https://private.example/source.png", thumbnailSrc: "https://private.example/source.png" };
  external.manifestHash = canonicalHash(external.manifest);
  external.attestation.manifestHash = external.manifestHash;
  const { attestationHash: _previous, ...externalUnsigned } = external.attestation;
  external.attestation.attestationHash = canonicalHash(externalUnsigned);
  assert.throws(() => validateReleaseAttestation(external), /sample is invalid|private or external/u);
});

test("routes bind QA hashing and export response-loss idempotency to the public contract", () => {
  const clone = readFileSync("src/app/api/internal/adstudio/template-factory/clone/route.ts", "utf8");
  const galleryExport = readFileSync("src/app/api/internal/adstudio/template-factory/gallery-export/route.ts", "utf8");
  assert.match(clone, /const canonicalQa = publicQa\(finalReview\);\s*if \(!canonicalQa\.passed\)[\s\S]*?const qaHash = canonicalHash\(canonicalQa\);/u);
  assert.match(clone, /evidence, qa: canonicalQa, attempts/u);
  assert.match(clone, /observed, exact: visibleQaText\(observed\) === visibleQaText\(check\.expected\)/u);
  assert.match(clone, /excludedContentInfluencedScore,\s*identityLeakage,\s*defects/u);
  assert.match(clone, /assertSuccessfulAttempts\(attempts\)/u);
  assert.match(clone, /schema: "adstudio\.template\.clone-intent\.v1"[\s\S]*?if \(body\.requestId !== intentHash\)/u);
  assert.match(clone, /beginFactoryClone\([\s\S]*?retryDisposition: "do_not_redispatch"/u);
  assert.match(clone, /status: "retryable"[\s\S]*?retryDisposition: "retryable_fresh_pulls"|retryDisposition: "retryable_fresh_pulls"[\s\S]*?status: "retryable"/u);
  assert.match(galleryExport, /existing\.request_hash === requestHash\).*releaseId: existing\.id, receiptId: existing\.id/su);
  assert.match(galleryExport, /exportIntentHash = canonicalHash\([\s\S]*?attestationHash: body\.attestation\.attestationHash[\s\S]*?idempotency-key/u);
  assert.match(galleryExport, /priorCandidateRelease\.manifest_hash === body\.manifestHash/u);
  assert.match(galleryExport, /deleteFactoryArtifact\(stored\.storagePath\)/u);
  assert.doesNotMatch(galleryExport, /createFactoryReceipt|release_bundle/u);
});

test("factory migration isolates cells, keeps the bucket private, and exposes only service-role RPCs", () => {
  const sql = readFileSync("supabase/migrations/20260811150000_adstudio_template_factory_staging.sql", "utf8");
  assert.match(sql, /'adstudio-template-factory'[\s\S]*?false/u);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /foreign key \(factory_cell_id, candidate_id\)/gu);
  assert.match(sql, /create table if not exists public\.adstudio_template_factory_clone_requests/u);
  assert.match(sql, /begin_adstudio_template_factory_clone/u);
  assert.match(sql, /bundle_hash text not null check \(bundle_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(sql, /where factory_cell_id = p_factory_cell_id/u);
  assert.match(sql, /auth\.role\(\) = 'service_role'|auth\.role\(\) <> 'service_role'/u);
  assert.match(sql, /revoke all on .* from public, anon, authenticated/iu);
  assert.doesNotMatch(sql, /create policy/iu);
  assert.match(sql, /raise notice 'AdStudio factory staging contains % candidate row\(s\)/u);
});

test("operator importer is cell-scoped, bundle-hash validating, source-free, and non-runtime", () => {
  const importer = readFileSync("scripts/adstudio/import-factory-release.mjs", "utf8");
  assert.match(importer, /\.eq\("factory_cell_id", factoryCellId\)/u);
  assert.match(importer, /sha256\(bundleBytes\) !== release\.bundle_hash/u);
  assert.match(importer, /artifacts", "adstudio-template-imports", releaseId/u);
  assert.match(importer, /assertSourceFree\(publicEvidence\)/u);
  assert.match(importer, /assertPublicSourceProvenance\(bundle\.manifest\.sourceAd\)/u);
  assert.match(importer, /adstudio:customer-fixture/u);
  assert.doesNotMatch(importer, /src", "lib", "adstudio", "template-gallery/u);
});

test("Blockwise keeps one post-Frank promotion path and no local source-to-sample factory", () => {
  const packageJson = readFileSync("package.json", "utf8");
  const fixture = readFileSync("scripts/adstudio/customer-template-fixture.mjs", "utf8");
  const promotion = readFileSync("scripts/adstudio/promote-factory-template.mjs", "utf8");
  const retiredFactoryStage = ["gallery", "sample"].join("_");
  assert.doesNotMatch(packageJson, /adstudio:create-template/u);
  assert.doesNotMatch(fixture, new RegExp(`${retiredFactoryStage}|analyseSource|private-source-corpus`, "u"));
  assert.match(fixture, /stage: "customer_fixture"/u);
  assert.match(fixture, /artifacts\/adstudio-template-imports/u);
  assert.match(promotion, /recordReview\(/u);
  assert.match(promotion, /assertPassingQa\(/u);
  assert.match(promotion, /npm", \["run", "verify:hard-reset"\]/u);
  assert.match(promotion, /rmSync\(path, \{ force: true \}\)/u);
  assert.match(promotion, /qualityLock: \{ templateHash \}/u);
  assert.match(promotion, /assertPublicSourceProvenance\(importedManifest\.sourceAd\)/u);
  assert.match(promotion, /assertPublicSourceProvenance\(prepared\.sourceAd\)/u);
  assert.match(promotion, /copyChecks: factoryPackage\.qa\.copyChecks/u);
  assert.match(promotion, /assetChecks: factoryPackage\.qa\.assetChecks/u);
  assert.doesNotMatch(promotion, /observed: field\.sample|Passed the attested Blockwise visual QA gate/u);
});
