import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adTemplateSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";
import { loadNativeTrialIdentity } from "./vue-native-copy.ts";
import { documentToken } from "./document-token.ts";
import { parseCustomerImageRef } from "./customer-image-ref.ts";
import { directTemplateRevisionIdentity, type SaveAdOutput, validateMetaCopyForSave } from "./save-ad.ts";
import {
  NATIVE_RENDERER_VERSION,
  NativeEditorValidationError,
  type NativePngExport,
  type ValidatedNativePng,
  validateNativeEditorDocument,
  validateNativePngExport,
} from "./vue-native-validation.ts";

export interface SaveNativeAdInput {
  supabase: SupabaseClient;
  templateSupabase?: SupabaseClient;
  workspaceId: string;
  adId: string;
  document: AdDocumentParsed;
  expectedRevision: number;
  exports: { feed: NativePngExport; story: NativePngExport };
}

export class NativeSaveError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeSaveError";
    this.code = code;
  }
}

export async function saveNativeAd(input: SaveNativeAdInput): Promise<SaveAdOutput> {
  const { data: ad, error: adError } = await input.supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id, template_id")
    .eq("id", input.adId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (adError || !ad) throw new NativeSaveError("ad_not_found", "Ad not found");

  const trial = await loadNativeTrialIdentity(input.supabase, input.workspaceId, input.adId);
  if (!trial || trial.sourceAdId !== input.document.nativeEditor?.sourceAdId) {
    throw new NativeSaveError("native_source_invalid", "Save native edits to the separate trial copy, not the original ad.");
  }

  const templateReader = input.templateSupabase ?? input.supabase;
  const { data: templateRow, error: templateError } = await templateReader
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", ad.template_id)
    .single();
  const parsedTemplate = adTemplateSchema.safeParse(templateRow?.template_json);
  if (templateError || !parsedTemplate.success) {
    throw new NativeSaveError("template_not_found", "Template not found");
  }
  const template = parsedTemplate.data;
  if (input.document.templateId !== ad.template_id || input.document.templateId !== template.templateId) {
    throw new NativeSaveError("template_contract_mismatch", "Document does not match the selected template");
  }
  if (!input.document.nativeEditor) {
    throw new NativeSaveError("native_editor_required", "Native editor data is required for this save.");
  }

  validateMetaCopyForSave(input.document);
  validateNativeEditorDocument({
    nativeEditor: input.document.nativeEditor,
    workspaceId: input.workspaceId,
    adId: input.adId,
    templateId: input.document.templateId,
  });
  validateDocumentImageRefs(input.document, input.workspaceId, input.adId);
  await validateSourceAdOwnership(input);

  const expectedActiveRevisionId = ad.active_revision_id ?? null;
  const currentRevision = await getActiveRevision(input.supabase, input.workspaceId, expectedActiveRevisionId);
  const currentRevisionNumber = currentRevision?.revision_number ?? 0;
  if (input.expectedRevision !== currentRevisionNumber) {
    throw new NativeSaveError("stale_revision", `Expected revision ${input.expectedRevision}, current is ${currentRevisionNumber}`);
  }

  const [feed, story] = await Promise.all([
    validateNativePngExport(input.exports.feed, "feed"),
    validateNativePngExport(input.exports.story, "story"),
  ]);
  const documentJson = input.document as unknown as Record<string, unknown>;
  const documentHash = documentToken(documentJson);
  if (
    currentRevision
    && currentRevision.document_hash === documentHash
    && currentRevision.feed_png_hash === feed.hash
    && currentRevision.story_png_hash === story.hash
  ) {
    return {
      adId: input.adId,
      revisionId: currentRevision.id,
      revisionNumber: currentRevision.revision_number,
      feedPngHash: feed.hash,
      storyPngHash: story.hash,
      unchanged: true,
    };
  }

  const feedPath = renderPath(input, "feed", feed.hash);
  const storyPath = renderPath(input, "story", story.hash);
  await Promise.all([
    uploadNativeRender(input.supabase, feedPath, feed),
    uploadNativeRender(input.supabase, storyPath, story),
  ]);

  const nextRevision = currentRevisionNumber + 1;
  const { data: revisionData, error: revisionError } = await input.supabase.rpc("commit_ad_revision", {
    p_ad_id: input.adId,
    p_workspace_id: input.workspaceId,
    p_expected_active_revision_id: expectedActiveRevisionId,
    p_revision: {
      revision_number: nextRevision,
      document_json: documentJson,
      document_hash: documentHash,
      feed_png_hash: feed.hash,
      feed_png_path: feedPath,
      story_png_hash: story.hash,
      story_png_path: storyPath,
      template_hash: directTemplateRevisionIdentity(template.templateId, template),
      renderer_version: NATIVE_RENDERER_VERSION,
    },
    p_attempts: [
      { placement: "feed", png_hash: feed.hash, png_path: feedPath, renderer_version: NATIVE_RENDERER_VERSION },
      { placement: "story", png_hash: story.hash, png_path: storyPath, renderer_version: NATIVE_RENDERER_VERSION },
    ],
  });
  if (revisionError) {
    const message = revisionError.message ?? "Could not commit the ad revision";
    if (message.includes("stale_revision")) {
      throw new NativeSaveError("stale_revision", "This ad changed in another editor. Reload and try again.");
    }
    if (message.includes("ad_not_found")) throw new NativeSaveError("ad_not_found", "Ad not found");
    throw new NativeSaveError("revision_commit_failed", message);
  }
  const revision = (Array.isArray(revisionData) ? revisionData[0] : revisionData) as {
    id?: unknown;
    revision_number?: unknown;
  } | null;
  if (!revision || typeof revision.id !== "string" || typeof revision.revision_number !== "number") {
    throw new NativeSaveError("revision_commit_failed", "Transactional save returned an invalid revision");
  }
  return {
    adId: input.adId,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    feedPngHash: feed.hash,
    storyPngHash: story.hash,
    unchanged: false,
  };
}

async function validateSourceAdOwnership(input: SaveNativeAdInput): Promise<void> {
  const sourceAdId = input.document.nativeEditor?.sourceAdId;
  if (!sourceAdId) return;
  if (sourceAdId === input.adId) {
    throw new NativeSaveError("native_source_invalid", "A native trial must be saved to a copied ad.");
  }
  const { data, error } = await input.supabase
    .from("ad_customer_ads")
    .select("id, template_id")
    .eq("id", sourceAdId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error || !data || data.template_id !== input.document.templateId) {
    throw new NativeSaveError("native_source_invalid", "Native editor source ad is not available in this workspace.");
  }
}

function validateDocumentImageRefs(document: AdDocumentParsed, workspaceId: string, adId: string): void {
  // Imported native trials must not retain media paths scoped to the source ad.
  // The copy endpoint rewrites these refs before the editor receives them.
  for (const value of Object.values(document.sharedImageValues)) {
    if (!value.startsWith("/api/adstudio/customer-media?")) continue;
    if (!parseCustomerImageRef(value, workspaceId, adId)) {
      throw new NativeSaveError("native_image_ref_invalid", "Native editor image does not belong to this copied ad.");
    }
  }
}

async function getActiveRevision(
  supabase: SupabaseClient,
  workspaceId: string,
  revisionId: string | null,
): Promise<{ id: string; revision_number: number; document_hash: string; feed_png_hash: string; story_png_hash: string } | null> {
  if (!revisionId) return null;
  const { data, error } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_hash, feed_png_hash, story_png_hash")
    .eq("id", revisionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) throw new NativeSaveError("active_revision_invalid", "The active saved revision could not be loaded");
  return data as typeof data & { id: string; revision_number: number; document_hash: string; feed_png_hash: string; story_png_hash: string };
}

function renderPath(input: SaveNativeAdInput, placement: "feed" | "story", hash: string): string {
  return `${input.workspaceId}/adstudio/renders/${input.adId}/${placement}-${hash}.png`;
}

async function uploadNativeRender(supabase: SupabaseClient, path: string, render: ValidatedNativePng): Promise<void> {
  const bucket = supabase.storage.from("workspace-artifacts");
  const uploaded = await bucket.upload(path, render.bytes, { contentType: "image/png", upsert: false });
  if (!uploaded.error) return;
  const existing = await bucket.download(path);
  if (!existing.error && existing.data) {
    const bytes = Buffer.from(await existing.data.arrayBuffer());
    const existingHash = createHash("sha256").update(bytes).digest("hex");
    if (existingHash === render.hash) return;
  }
  throw new NativeSaveError("render_upload_failed", "Could not store the native editor render.");
}

export { NativeEditorValidationError };
