import type { SupabaseClient } from "@supabase/supabase-js";

import { adTemplateSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";
import { createCustomerAd, loadCustomerAd } from "./create-customer-ad.ts";
import { createHash } from "node:crypto";
import { validateCustomerImageBytes } from "./image-validation.ts";
import { buildCustomerImageRef, CUSTOMER_IMAGE_BUCKET, parseCustomerImageRef } from "./customer-image-ref.ts";
import { documentToken } from "./document-token.ts";

export type NativeTrialCopy = {
  adId: string;
  workspaceId: string;
  templateId: string;
  sourceAdId: string;
  sourceRevision: number | null;
  revisionNumber: number;
  sourceDocument?: AdDocumentParsed;
};

export class NativeCopyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeCopyError";
    this.code = code;
  }
}

export const NATIVE_TRIAL_CREATION_KEY_PREFIX = "vue-trial:v1:";

export function nativeTrialCreationKey(sourceAdId: string): string {
  return `${NATIVE_TRIAL_CREATION_KEY_PREFIX}${sourceAdId}`;
}

export function nativeTrialSourceId(creationKey: unknown): string | null {
  if (typeof creationKey !== "string" || !creationKey.startsWith(NATIVE_TRIAL_CREATION_KEY_PREFIX)) return null;
  const sourceAdId = creationKey.slice(NATIVE_TRIAL_CREATION_KEY_PREFIX.length);
  return sourceAdId && sourceAdId.length <= 128 ? sourceAdId : null;
}

/** Proves an ad is the bounded server-created native trial for its source. */
export async function loadNativeTrialIdentity(
  supabase: SupabaseClient,
  workspaceId: string,
  adId: string,
): Promise<{ sourceAdId: string; templateId: string } | null> {
  const { data: trial, error } = await supabase
    .from("ad_customer_ads")
    .select("id, template_id, creation_key")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !trial) return null;
  const sourceAdId = nativeTrialSourceId(trial.creation_key);
  if (!sourceAdId || sourceAdId === adId) return null;
  const { data: source, error: sourceError } = await supabase
    .from("ad_customer_ads")
    .select("id, template_id")
    .eq("id", sourceAdId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (sourceError || !source || source.template_id !== trial.template_id) return null;
  return { sourceAdId, templateId: String(trial.template_id) };
}

/**
 * Creates a distinct customer-ad row before the native editor opens. Source
 * revisions and their old editor remain untouched. Ad-scoped customer media
 * is copied and rewritten so the trial cannot depend on another ad's paths.
 */
export async function copyAdToNativeTrial(input: {
  supabase: SupabaseClient;
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  sourceAdId: string;
}): Promise<NativeTrialCopy> {
  const { data: sourceRow, error: sourceError } = await input.supabase
    .from("ad_customer_ads")
    .select("id, name, template_id, active_revision_id, creation_key")
    .eq("id", input.sourceAdId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (sourceError || !sourceRow) throw new NativeCopyError("source_ad_not_found", "Source ad not found.");
  if (nativeTrialSourceId(sourceRow.creation_key)) {
    throw new NativeCopyError("native_source_invalid", "Create the native editor trial from the original ad.");
  }

  const { data: templateRow, error: templateError } = await input.serviceSupabase
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", sourceRow.template_id)
    .single();
  const parsedTemplate = adTemplateSchema.safeParse(templateRow?.template_json);
  if (templateError || !parsedTemplate.success || parsedTemplate.data.templateId !== sourceRow.template_id) {
    throw new NativeCopyError("template_not_found", "The source ad template is not available.");
  }

  const source = await loadCustomerAd(input.supabase, input.workspaceId, input.sourceAdId);
  if (source.initialDocument?.nativeEditor) {
    throw new NativeCopyError("native_source_invalid", "Create the native editor trial from the original ad.");
  }
  // The source ad already consumed its pack allowance. This one stable copy is
  // an editor alternative for that entitled ad, not a new pack purchase.
  const replayKey = nativeTrialCreationKey(input.sourceAdId);
  const { data: existingTrial, error: replayError } = await input.supabase
    .from("ad_customer_ads")
    .select("id, template_id, active_revision_id")
    .eq("workspace_id", input.workspaceId)
    .eq("creation_key", replayKey)
    .maybeSingle();
  if (replayError) throw new NativeCopyError("trial_lookup_failed", "The native editor trial could not be checked.");
  if (existingTrial?.active_revision_id) {
    if (existingTrial.template_id !== sourceRow.template_id) throw new NativeCopyError("native_source_invalid", "The native editor trial template does not match its source.");
    const replay = await loadCustomerAd(input.supabase, input.workspaceId, String(existingTrial.id));
    return {
      adId: String(existingTrial.id), workspaceId: input.workspaceId, templateId: parsedTemplate.data.templateId,
      sourceAdId: input.sourceAdId, sourceRevision: source.revisionNumber ?? null, revisionNumber: replay.revisionNumber ?? 0,
      ...(replay.initialDocument ? { sourceDocument: replay.initialDocument } : {}),
    };
  }
  const trial = await createCustomerAd(input.supabase, input.workspaceId, parsedTemplate.data, replayKey);
  let sourceDocument = source.initialDocument;
  if (sourceDocument) {
    const rewrittenImages = await copyCustomerImages({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      sourceAdId: input.sourceAdId,
      trialAdId: trial.adId,
      values: sourceDocument.sharedImageValues,
    });
    sourceDocument = { ...sourceDocument, sharedImageValues: rewrittenImages };
  }

  if (sourceDocument && sourceRow.active_revision_id) {
    sourceDocument = { ...sourceDocument, revision: 1 };
    await forkSourceRevision({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      sourceRevisionId: String(sourceRow.active_revision_id),
      trialAdId: trial.adId,
      document: sourceDocument,
    });
  }

  const sourceName = typeof sourceRow.name === "string" ? sourceRow.name.trim() : "";
  if (sourceName) {
    const renamed = await input.supabase
      .from("ad_customer_ads")
      .update({ name: `${sourceName} native trial`.slice(0, 160) })
      .eq("id", trial.adId)
      .eq("workspace_id", input.workspaceId);
    if (renamed.error) throw new NativeCopyError("trial_update_failed", "The trial ad could not be named.");
  }

  return {
    adId: trial.adId,
    workspaceId: input.workspaceId,
    templateId: parsedTemplate.data.templateId,
    sourceAdId: input.sourceAdId,
    sourceRevision: source.revisionNumber ?? null,
    revisionNumber: sourceDocument && sourceRow.active_revision_id ? 1 : 0,
    ...(sourceDocument ? { sourceDocument } : {}),
  };
}

async function forkSourceRevision(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  sourceRevisionId: string;
  trialAdId: string;
  document: AdDocumentParsed;
}): Promise<void> {
  const { data: sourceRevision, error: sourceRevisionError } = await input.supabase
    .from("ad_revisions")
    .select("feed_png_hash, feed_png_path, story_png_hash, story_png_path, template_hash, renderer_version")
    .eq("id", input.sourceRevisionId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (sourceRevisionError || !sourceRevision?.feed_png_hash || !sourceRevision?.feed_png_path || !sourceRevision?.story_png_hash || !sourceRevision?.story_png_path) {
    throw new NativeCopyError("source_revision_invalid", "The saved source ad could not be copied safely.");
  }
  const revision = {
    revision_number: 1,
    document_json: input.document as unknown as Record<string, unknown>,
    document_hash: documentToken(input.document),
    feed_png_hash: sourceRevision.feed_png_hash,
    feed_png_path: sourceRevision.feed_png_path,
    story_png_hash: sourceRevision.story_png_hash,
    story_png_path: sourceRevision.story_png_path,
    template_hash: sourceRevision.template_hash,
    renderer_version: sourceRevision.renderer_version,
  };
  const committed = await input.supabase.rpc("commit_ad_revision", {
    p_ad_id: input.trialAdId,
    p_workspace_id: input.workspaceId,
    p_expected_active_revision_id: null,
    p_revision: revision,
    p_attempts: [
      { placement: "feed", png_hash: revision.feed_png_hash, png_path: revision.feed_png_path, renderer_version: revision.renderer_version },
      { placement: "story", png_hash: revision.story_png_hash, png_path: revision.story_png_path, renderer_version: revision.renderer_version },
    ],
  });
  if (committed.error) {
    if (committed.error.message?.includes("stale_revision")) return;
    throw new NativeCopyError("trial_revision_failed", "The native editor trial could not copy the saved source revision.");
  }
}

async function copyCustomerImages(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  sourceAdId: string;
  trialAdId: string;
  values: Record<string, string>;
}): Promise<Record<string, string>> {
  const copied: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values)) {
    const parsed = parseCustomerImageRef(value, input.workspaceId, input.sourceAdId);
    if (!parsed) throw new NativeCopyError("source_image_invalid", `Source image ${key} is not available for this trial.`);
    const downloaded = await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).download(parsed.path);
    if (downloaded.error || !downloaded.data) {
      throw new NativeCopyError("source_image_missing", `Source image ${key} could not be copied.`);
    }
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    await validateCustomerImageBytes(bytes, parsed.mime);
    if (createHash("sha256").update(bytes).digest("hex") !== parsed.sha256) {
      throw new NativeCopyError("source_image_invalid", `Source image ${key} failed its integrity check.`);
    }
    const ref = buildCustomerImageRef(input.workspaceId, input.trialAdId, parsed.sha256, parsed.mime);
    const storedRef = parseCustomerImageRef(ref, input.workspaceId, input.trialAdId)!;
    await finalizeCopiedImageLedger({
      serviceSupabase: input.serviceSupabase, workspaceId: input.workspaceId,
      adId: input.trialAdId, path: storedRef.path, sha256: parsed.sha256,
      mime: parsed.mime, size: bytes.length, bytes,
    });
    copied[key] = ref;
  }
  return copied;
}

async function finalizeCopiedImageLedger(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  adId: string;
  path: string;
  sha256: string;
  mime: string;
  size: number;
  bytes: Buffer;
}): Promise<void> {
  const metadata = {
    p_workspace_id: input.workspaceId,
    p_ad_id: input.adId,
    p_object_path: input.path,
    p_sha256: input.sha256,
    p_mime_type: input.mime,
    p_byte_size: input.size,
  };
  const prepared = await input.serviceSupabase.rpc("adstudio_prepare_customer_image_upload", metadata);
  const prepareResult = asRpcObject(prepared.data);
  if (prepared.error || prepareResult.ok !== true) {
    throw new NativeCopyError("source_image_copy_failed", "The copied image could not be reserved safely.");
  }
  if (prepareResult.status === "finalized") return;
  const reservationId = typeof prepareResult.reservation_id === "string" ? prepareResult.reservation_id : null;
  if (!reservationId) throw new NativeCopyError("source_image_copy_failed", "The copied image reservation was invalid.");
  const claimed = await input.serviceSupabase.rpc("adstudio_claim_customer_image_finalize", {
    p_reservation_id: reservationId,
    ...metadata,
  });
  if (claimed.error || asRpcObject(claimed.data).ok !== true) {
    throw new NativeCopyError("source_image_copy_failed", "The copied image could not be finalized safely.");
  }
  // Reserve quota and claim the finalization before storing any copied bytes.
  const bucket = input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET);
  const uploaded = await bucket.upload(input.path, input.bytes, { contentType: input.mime, upsert: false });
  if (uploaded.error) {
    const existing = await bucket.download(input.path);
    if (existing.error || !existing.data || createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex") !== input.sha256) {
      throw new NativeCopyError("source_image_copy_failed", "The image copy could not be stored safely.");
    }
  }
  const finalized = await input.serviceSupabase.rpc("adstudio_finalize_customer_image_upload", {
    p_reservation_id: reservationId,
    ...metadata,
  });
  if (finalized.error || asRpcObject(finalized.data).ok !== true) {
    throw new NativeCopyError("source_image_copy_failed", "The copied image could not be finalized safely.");
  }
}

function asRpcObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
