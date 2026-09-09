import { randomUUID } from "node:crypto";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { bytesHash, canonicalHash, pullFingerprint, type PullReceipt } from "./template-factory-contract.ts";

const FACTORY_BUCKET = "adstudio-template-factory";

export type TemplateFactoryConfig = {
  cellId: string;
  serviceToken: string;
  pullToken: string;
  pullOrigin: string;
  pullPathPrefix: string;
  accountingWorkspaceId: string;
  accountingUserId: string;
  publicOrigin: string;
  resultPullToken: string;
};

export function resolveTemplateFactoryConfig(env: NodeJS.ProcessEnv = process.env): TemplateFactoryConfig {
  const config = {
    cellId: env.FRANK_FACTORY_CELL_ID?.trim() ?? "",
    serviceToken: env.BLOCKWISE_FRANK_SERVICE_TOKEN?.trim() ?? "",
    pullToken: env.FRANK_PULL_SERVICE_TOKEN?.trim() ?? "",
    pullOrigin: env.FRANK_PULL_ORIGIN?.trim() ?? "",
    pullPathPrefix: env.FRANK_PULL_PATH_PREFIX?.trim() ?? "",
    accountingWorkspaceId: env.ADSTUDIO_FACTORY_ACCOUNTING_WORKSPACE_ID?.trim() ?? "",
    accountingUserId: env.ADSTUDIO_FACTORY_ACCOUNTING_USER_ID?.trim() ?? "",
    publicOrigin: env.BLOCKWISE_PUBLIC_ORIGIN?.trim() ?? "",
    resultPullToken: env.BLOCKWISE_FRANK_RESULT_PULL_TOKEN?.trim() ?? "",
  };
  if (Object.values(config).some((value) => !value)) throw new Error("AdStudio template factory is not configured.");
  const pullOrigin = new URL(config.pullOrigin);
  const publicOrigin = new URL(config.publicOrigin);
  if (pullOrigin.protocol !== "https:" || pullOrigin.origin !== config.pullOrigin.replace(/\/$/u, "")
    || publicOrigin.protocol !== "https:" || publicOrigin.origin !== config.publicOrigin.replace(/\/$/u, "")) {
    throw new Error("AdStudio template factory origins must be exact HTTPS origins.");
  }
  if (!config.pullPathPrefix.startsWith("/") || config.pullPathPrefix === "/") throw new Error("AdStudio template factory pull path is invalid.");
  if (new Set([config.serviceToken, config.pullToken, config.resultPullToken]).size !== 3) throw new Error("AdStudio template factory credentials must be distinct.");
  return config;
}

export async function claimPullReceipts(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
  receipts: PullReceipt[];
}): Promise<boolean> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("claim_adstudio_template_factory_pulls", {
    p_factory_cell_id: input.config.cellId,
    p_factory_job_id: input.factoryJobId,
    p_request_id: input.requestId,
    p_fingerprints: input.receipts.map(pullFingerprint),
  });
  if (error) throw new Error("Template factory receipt claim failed.");
  return data === true;
}

export async function beginFactoryClone(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
  intentHash: string;
}): Promise<{ disposition: "start" | "replay" | "intent_conflict"; status: string; response: Record<string, unknown> | null }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("begin_adstudio_template_factory_clone", {
    p_factory_cell_id: input.config.cellId,
    p_factory_job_id: input.factoryJobId,
    p_request_id: input.requestId,
    p_intent_hash: input.intentHash,
  });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Template factory clone ledger could not be started.");
  const row = data[0] as { disposition: "start" | "replay" | "intent_conflict"; clone_status: string; response_json: Record<string, unknown> | null };
  return { disposition: row.disposition, status: row.clone_status, response: row.response_json };
}

export async function finishFactoryClone(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
  status: "retryable" | "succeeded" | "terminal" | "ambiguous";
  response?: Record<string, unknown>;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_clone_requests")
    .update({ status: input.status, response_json: input.response ?? null, updated_at: new Date().toISOString() })
    .eq("factory_cell_id", input.config.cellId)
    .eq("factory_job_id", input.factoryJobId)
    .eq("request_id", input.requestId)
    .eq("status", "running")
    .select("request_id");
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Template factory clone ledger could not be finalized.");
}

export async function uploadFactoryArtifact(input: {
  config: TemplateFactoryConfig;
  category: "candidates" | "releases";
  id: string;
  bytes: Uint8Array;
  contentType: string;
  extension: "png" | "json";
}): Promise<{ storagePath: string; contentHash: string }> {
  const service = createSupabaseServiceClient();
  const cell = canonicalHash(input.config.cellId).slice(0, 24);
  const storagePath = `template-factory/${cell}/${input.category}/${input.id}.${input.extension}`;
  const { error } = await service.storage.from(FACTORY_BUCKET).upload(storagePath, input.bytes, {
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw new Error("Template factory artifact could not be stored.");
  return { storagePath, contentHash: bytesHash(input.bytes) };
}

export async function persistFactoryCandidate(input: {
  config: TemplateFactoryConfig;
  candidateId: string;
  factoryJobId: string;
  requestId: string;
  requestHash: string;
  templateId: string;
  sourceHash: string;
  sampleHash: string;
  safeTextHash: string;
  cloneRequestHash: string;
  qaHash: string;
  evidenceHash: string;
  storagePath: string;
  evidence: unknown;
  qa: unknown;
  attempts: unknown[];
  expiresAt: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("adstudio_template_factory_candidates").insert({
    id: input.candidateId,
    factory_cell_id: input.config.cellId,
    factory_job_id: input.factoryJobId,
    request_id: input.requestId,
    request_hash: input.requestHash,
    template_id: input.templateId,
    source_hash: input.sourceHash,
    sample_hash: input.sampleHash,
    safe_text_hash: input.safeTextHash,
    clone_request_hash: input.cloneRequestHash,
    qa_hash: input.qaHash,
    evidence_hash: input.evidenceHash,
    storage_path: input.storagePath,
    evidence_json: input.evidence,
    qa_json: input.qa,
    attempts_json: input.attempts,
    expires_at: input.expiresAt,
  });
  if (error) throw new Error("Template factory candidate could not be staged.");
}

export async function createFactoryReceipt(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
  kind: "candidate_png";
  candidateId: string;
  storagePath: string;
  contentHash: string;
  expiresAt: string;
}): Promise<{ url: string; contentHash: string; expiresAt: string }> {
  const receiptId = randomUUID();
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_receipts").upsert({
    id: receiptId,
    factory_cell_id: input.config.cellId,
    factory_job_id: input.factoryJobId,
    request_id: input.requestId,
    kind: input.kind,
    candidate_id: input.candidateId,
    storage_path: input.storagePath,
    content_hash: input.contentHash,
    expires_at: input.expiresAt,
    consumed_at: null,
  }, { onConflict: "factory_cell_id,factory_job_id,request_id,kind" }).select("id").single();
  if (error || !data?.id) throw new Error("Template factory result receipt could not be created.");
  return {
    url: `${new URL(input.config.publicOrigin).origin}/api/internal/adstudio/template-factory/receipts/${data.id}`,
    contentHash: input.contentHash,
    expiresAt: input.expiresAt,
  };
}

export async function consumeFactoryReceipt(config: TemplateFactoryConfig, receiptId: string) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("consume_adstudio_template_factory_receipt", {
    p_factory_cell_id: config.cellId,
    p_receipt_id: receiptId,
  });
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as { kind: string; storage_path: string; content_hash: string; candidate_id: string };
  const { data: artifact, error: downloadError } = await service.storage.from(FACTORY_BUCKET).download(row.storage_path);
  if (downloadError || !artifact) throw new Error("Template factory receipt artifact is unavailable.");
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  if (bytesHash(bytes) !== row.content_hash) throw new Error("Template factory receipt artifact failed integrity verification.");
  return { ...row, bytes };
}

export async function loadFactoryCandidate(input: {
  config: TemplateFactoryConfig;
  candidateId: string;
  factoryJobId: string;
}) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_candidates")
    .select("*")
    .eq("factory_cell_id", input.config.cellId)
    .eq("factory_job_id", input.factoryJobId)
    .eq("id", input.candidateId)
    .maybeSingle();
  if (error) throw new Error("Template factory candidate lookup failed.");
  return data;
}

export async function loadFactoryCandidateByRequest(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
}) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_candidates")
    .select("id,request_hash,evidence_hash,template_id,source_hash,sample_hash,safe_text_hash,clone_request_hash,qa_hash,storage_path,evidence_json,qa_json,attempts_json,expires_at")
    .eq("factory_cell_id", input.config.cellId)
    .eq("factory_job_id", input.factoryJobId)
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (error) throw new Error("Template factory idempotency lookup failed.");
  return data;
}

export async function deleteFactoryArtifact(storagePath: string): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.storage.from(FACTORY_BUCKET).remove([storagePath]);
  if (error) throw new Error("Template factory artifact cleanup failed.");
}

export async function persistFactoryRelease(input: {
  config: TemplateFactoryConfig;
  releaseId: string;
  candidateId: string;
  factoryJobId: string;
  requestId: string;
  requestHash: string;
  manifestHash: string;
  attestationHash: string;
  sampleHash: string;
  bundleHash: string;
  storagePath: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();
  const { error } = await service.from("adstudio_template_factory_releases").insert({
    id: input.releaseId,
    candidate_id: input.candidateId,
    factory_cell_id: input.config.cellId,
    factory_job_id: input.factoryJobId,
    request_id: input.requestId,
    request_hash: input.requestHash,
    manifest_hash: input.manifestHash,
    attestation_hash: input.attestationHash,
    sample_hash: input.sampleHash,
    bundle_hash: input.bundleHash,
    storage_path: input.storagePath,
  });
  if (error) throw new Error("Template factory release could not be staged.");
}

export async function loadFactoryReleaseByRequest(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  requestId: string;
}) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_releases")
    .select("id,request_hash,manifest_hash,attestation_hash")
    .eq("factory_cell_id", input.config.cellId)
    .eq("factory_job_id", input.factoryJobId)
    .eq("request_id", input.requestId)
    .maybeSingle();
  if (error) throw new Error("Template factory release idempotency lookup failed.");
  return data;
}

export async function loadFactoryReleaseByCandidate(input: {
  config: TemplateFactoryConfig;
  factoryJobId: string;
  candidateId: string;
}) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("adstudio_template_factory_releases")
    .select("id,request_hash,manifest_hash,attestation_hash")
    .eq("factory_cell_id", input.config.cellId)
    .eq("factory_job_id", input.factoryJobId)
    .eq("candidate_id", input.candidateId)
    .maybeSingle();
  if (error) throw new Error("Template factory release candidate lookup failed.");
  return data;
}
