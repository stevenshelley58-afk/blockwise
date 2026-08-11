import { createHash, timingSafeEqual } from "node:crypto";

export const TEMPLATE_FACTORY_CLONE_SCHEMA = "adstudio.template.clone.v1";
export const TEMPLATE_FACTORY_EXPORT_SCHEMA = "adstudio.template.gallery-export.v1";
export const TEMPLATE_FACTORY_EVIDENCE_SCHEMA = "adstudio.template.candidate-evidence.v1";
export const TEMPLATE_FACTORY_ATTESTATION_SCHEMA = "adstudio.template.release-attestation.v1";
export const TEMPLATE_FACTORY_APPROVAL_CONFIRMATION = "inspected-native-source-and-sample";
export const TEMPLATE_FACTORY_RECEIPT_TTL_MS = 5 * 60_000;
export const TEMPLATE_FACTORY_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type PullReceipt = { url: string; contentHash: string; expiresAt: string };
export type TemplateFactoryImageInput = { key: string; label: string; description: string; aspect?: string; required: boolean };
export type TemplateFactoryTextInput = { key: string; label: string; maxLength: number; required: boolean; sample: string };
export type TemplateFactoryDraft = {
  id: string;
  name: string;
  format: "4:5" | "9:16";
  dimensions: { width: number; height: number };
  classification: {
    ad_type: string;
    primary_intent: string;
    property_or_agent_focus: "property" | "agent" | "both";
  };
  inputs: { images: TemplateFactoryImageInput[]; text: TemplateFactoryTextInput[] };
  sourceAd: { creativeId?: string; file?: string; contentHash: string };
  [key: string]: unknown;
};

export type TemplateFactoryCloneBody = {
  schema: typeof TEMPLATE_FACTORY_CLONE_SCHEMA;
  purpose: "public_sample";
  factoryJobId: string;
  requestId: string;
  draft: TemplateFactoryDraft;
  sourceReference: PullReceipt;
  genericImages: Record<string, PullReceipt>;
  safeText: Record<string, string>;
};

export type CandidateEvidence = {
  schema: typeof TEMPLATE_FACTORY_EVIDENCE_SCHEMA;
  factoryJobId: string;
  requestId: string;
  candidateId: string;
  templateId: string;
  sourceHash: string;
  sampleHash: string;
  safeTextHash: string;
  genericImageHashes: Record<string, string>;
  inputsHash: string;
  cloneRequestHash: string;
  qaHash: string;
  attemptsHash: string;
};

export type ReleaseApproval = {
  reviewerId: string;
  reviewedAt: string;
  reviewSessionId: string;
  confirmation: typeof TEMPLATE_FACTORY_APPROVAL_CONFIRMATION;
};

export type ReleaseAttestation = {
  schema: typeof TEMPLATE_FACTORY_ATTESTATION_SCHEMA;
  factoryJobId: string;
  candidateId: string;
  sourceHash: string;
  sampleHash: string;
  safeTextHash: string;
  cloneRequestHash: string;
  qaHash: string;
  evidenceHash: string;
  manifestHash: string;
  approval: ReleaseApproval;
  approvalHash: string;
  attestationHash: string;
};

export type TemplateFactoryExportBody = {
  schema: typeof TEMPLATE_FACTORY_EXPORT_SCHEMA;
  factoryJobId: string;
  requestId: string;
  candidateId: string;
  manifest: Record<string, unknown>;
  manifestHash: string;
  samplePull: PullReceipt;
  attestation: ReleaseAttestation;
};

type PublicGalleryManifest = TemplateFactoryDraft & {
  sample: {
    imageSrc: string;
    thumbnailSrc: string;
    alt: string;
    contentHash: string;
    generatedBy: "reference_clone";
  };
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortCanonical(item)]),
  );
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function bytesHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeBearerMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!secret?.trim() || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret.trim(), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function validatePullReceipt(receipt: PullReceipt, allowedOrigin: string, now = Date.now(), allowedPathPrefix = "/"): URL {
  if (!receipt || typeof receipt.url !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.contentHash)) {
    throw new Error("Pull receipt is malformed.");
  }
  const url = new URL(receipt.url);
  const allowed = new URL(allowedOrigin);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" || allowed.protocol !== "https:" || url.origin !== allowed.origin) {
    throw new Error("Pull receipt origin is not allowed.");
  }
  const prefix = allowedPathPrefix.startsWith("/") ? allowedPathPrefix : `/${allowedPathPrefix}`;
  if (prefix === "/" || !url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) {
    throw new Error("Pull receipt path is not allowed.");
  }
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + TEMPLATE_FACTORY_RECEIPT_TTL_MS) {
    throw new Error("Pull receipt is expired or exceeds the allowed lifetime.");
  }
  return url;
}

export function validateExactInputKeys(body: Pick<TemplateFactoryCloneBody, "draft" | "genericImages" | "safeText">): void {
  assertUniqueKeys(body.draft.inputs.images.map((input) => input.key), "image");
  assertUniqueKeys(body.draft.inputs.text.map((input) => input.key), "text");
  assertExactKeys(body.draft.inputs.images.map((input) => input.key), Object.keys(body.genericImages), "image");
  assertExactKeys(body.draft.inputs.text.map((input) => input.key), Object.keys(body.safeText), "text");
  for (const field of body.draft.inputs.text) {
    const value = body.safeText[field.key];
    if (field.required && !value?.trim()) throw new Error(`Required text input ${field.key} is empty.`);
    if (typeof value !== "string" || value.length > field.maxLength) throw new Error(`Text input ${field.key} is invalid.`);
  }
}

function assertUniqueKeys(keys: string[], kind: string): void {
  if (keys.some((key) => !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(key)) || new Set(keys).size !== keys.length) {
    throw new Error(`Declared ${kind} keys are invalid or duplicated.`);
  }
}

function assertExactKeys(expected: string[], received: string[], kind: string): void {
  const left = [...expected].sort();
  const right = [...received].sort();
  if (left.length !== right.length || left.some((key, index) => key !== right[index])) {
    throw new Error(`The ${kind} input keys do not exactly match the declared template inputs.`);
  }
}

export function buildCandidateEvidence(input: Omit<CandidateEvidence, "schema">): { evidence: CandidateEvidence; evidenceHash: string } {
  const evidence: CandidateEvidence = { schema: TEMPLATE_FACTORY_EVIDENCE_SCHEMA, ...input };
  return { evidence, evidenceHash: canonicalHash(evidence) };
}

export function validateReleaseAttestation(body: TemplateFactoryExportBody): void {
  if (body.schema !== TEMPLATE_FACTORY_EXPORT_SCHEMA || body.attestation.schema !== TEMPLATE_FACTORY_ATTESTATION_SCHEMA) {
    throw new Error("Gallery export schema is invalid.");
  }
  if (body.manifestHash !== canonicalHash(body.manifest)) throw new Error("Gallery manifest hash is invalid.");
  if (body.attestation.factoryJobId !== body.factoryJobId || body.attestation.candidateId !== body.candidateId || body.attestation.manifestHash !== body.manifestHash) {
    throw new Error("Gallery attestation binding is invalid.");
  }
  const approval = body.attestation.approval;
  if (approval.confirmation !== TEMPLATE_FACTORY_APPROVAL_CONFIRMATION || !approval.reviewerId?.trim() || !approval.reviewSessionId?.trim() || !Number.isFinite(Date.parse(approval.reviewedAt))) {
    throw new Error("Gallery approval evidence is invalid.");
  }
  if (body.attestation.approvalHash !== canonicalHash(approval)) throw new Error("Gallery approval hash is invalid.");
  const { attestationHash: _hash, ...attestationPayload } = body.attestation;
  if (body.attestation.attestationHash !== canonicalHash(attestationPayload)) throw new Error("Gallery attestation hash is invalid.");
  validatePublicGalleryManifest(body.manifest);
}

function validatePublicGalleryManifest(value: Record<string, unknown>): asserts value is PublicGalleryManifest {
  const manifest = value as Partial<PublicGalleryManifest>;
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/u.test(String(manifest.id ?? "")) || !manifest.name?.trim()) {
    throw new Error("Gallery manifest identity is invalid.");
  }
  if (manifest.format !== "4:5" && manifest.format !== "9:16") throw new Error("Gallery manifest format is invalid.");
  const requiredDimensions = manifest.format === "4:5" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
  if (manifest.dimensions?.width !== requiredDimensions.width || manifest.dimensions?.height !== requiredDimensions.height) {
    throw new Error("Gallery manifest dimensions are invalid.");
  }
  if (!Array.isArray(manifest.inputs?.images) || !Array.isArray(manifest.inputs?.text)) throw new Error("Gallery manifest inputs are invalid.");
  const classification = manifest.classification;
  if (!classification?.ad_type?.trim() || !classification.primary_intent?.trim() || !["property", "agent", "both"].includes(String(classification.property_or_agent_focus))) {
    throw new Error("Gallery manifest classification is invalid.");
  }
  if (!manifest.sourceAd || !/^[a-f0-9]{64}$/u.test(String(manifest.sourceAd.contentHash ?? ""))) throw new Error("Gallery manifest provenance is invalid.");
  const sample = manifest.sample;
  if (!sample || !/^[a-f0-9]{64}$/u.test(String(sample.contentHash ?? "")) || sample.generatedBy !== "reference_clone"
    || sample.imageSrc !== sample.thumbnailSrc || !sample.alt?.trim()
    || !/^\/adstudio-samples\/meta\/[a-z0-9][a-z0-9-]*\.png$/u.test(String(sample.imageSrc ?? ""))) {
    throw new Error("Gallery manifest sample is invalid.");
  }
  assertSourceFree(value);
}

function assertSourceFree(value: unknown, key = "manifest"): void {
  if (typeof value === "string") {
    const publicAsset = /^\/(?:adstudio-samples\/meta\/[a-z0-9][a-z0-9-]*\.png|fonts\/adstudio\/[a-z0-9][a-z0-9-]*\.woff2)$/u.test(value);
    if (/^(?:data:|https?:|file:)/iu.test(value) || (value.startsWith("/") && !publicAsset) || value.includes("\\") || value.includes("..")) {
      throw new Error(`Gallery manifest contains a private or external value at ${key}.`);
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertSourceFree(item, `${key}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:sourceReference|privatePath|bytes|dataUrl|base64|layers|recipe|versions|fonts)$/iu.test(childKey)) throw new Error(`Gallery manifest contains forbidden field ${childKey}.`);
    assertSourceFree(child, `${key}.${childKey}`);
  }
}

export function pullFingerprint(receipt: PullReceipt): string {
  return canonicalHash({ url: receipt.url, contentHash: receipt.contentHash, expiresAt: receipt.expiresAt });
}

export async function fetchVerifiedPullImage(input: {
  receipt: PullReceipt;
  allowedOrigin: string;
  pullBearer: string;
  allowedPathPrefix: string;
  claim: (fingerprint: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array; dataUrl: string; contentType: "image/png" | "image/jpeg" | "image/webp" }> {
  const url = validatePullReceipt(input.receipt, input.allowedOrigin, input.now, input.allowedPathPrefix);
  if (!await input.claim(pullFingerprint(input.receipt))) throw new Error("Pull receipt was already used.");
  let response: Response;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    response = await Promise.race([
      (input.fetchImpl ?? fetch)(url, {
        headers: { authorization: `Bearer ${input.pullBearer}` },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Pull timeout."));
        }, input.timeoutMs ?? 10_000);
      }),
    ]);
  } catch {
    throw new Error("Pull receipt could not be fetched.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Pull receipt could not be fetched.");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/webp") {
    throw new Error("Pull receipt did not return a supported image.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  const maxBytes = input.maxBytes ?? TEMPLATE_FACTORY_MAX_IMAGE_BYTES;
  if (declaredLength > maxBytes) throw new Error("Pull image exceeds the size limit.");
  if (!response.body) throw new Error("Pull receipt returned no image body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Pull image exceeds the size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (bytes.byteLength === 0) throw new Error("Pull image is empty.");
  if (!magicMatches(contentType, bytes)) throw new Error("Pull image MIME does not match its bytes.");
  if (bytesHash(bytes) !== input.receipt.contentHash) throw new Error("Pull image hash does not match its receipt.");
  return { bytes, dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`, contentType };
}

function magicMatches(contentType: "image/png" | "image/jpeg" | "image/webp", bytes: Uint8Array): boolean {
  if (contentType === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}
