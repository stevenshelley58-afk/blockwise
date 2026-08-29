import { isDeepStrictEqual } from "node:util";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  adTemplateSchema,
  type AdTemplateParsed,
} from "../../../packages/ad-template-contract/src/schema.ts";

export { adTemplateSchema } from "../../../packages/ad-template-contract/src/schema.ts";

const ARTIFACT_BUCKET = "workspace-artifacts";

const relativeAssetFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => {
    if (value.startsWith("/") || value.includes("\\")) return false;
    const segments = value.split("/");
    return segments.every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9._-]+$/.test(segment),
    );
  }, "asset filename must be a normalized relative POSIX path");

const artifactAssetSchema = z
  .object({
    assetKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    fileName: relativeAssetFileNameSchema,
    mimeType: z.string().min(1).max(128),
    bytesBase64: z.string().min(1),
  })
  .strict();

const directArtifactSchema = z
  .object({
    template: adTemplateSchema,
    assets: z.array(artifactAssetSchema).max(256),
  })
  .strict();

type ArtifactAsset = z.infer<typeof artifactAssetSchema>;
type StoredAssetRow = {
  asset_key: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
};

export type DirectTemplateArtifact = z.infer<typeof directArtifactSchema>;
export type IngestTemplateArtifactResult = {
  templateId: string;
  assetCount: number;
  replayed: boolean;
};

function storagePath(templateId: string, assetKey: string, fileName: string) {
  return ["templates", templateId, `${assetKey}-${fileName}`]
    .map((component) => encodeURIComponent(component))
    .join("/");
}

function failConflict(): never {
  throw new Error("template_artifact_conflict");
}

function decodeBase64Strict(value: string): Buffer {
  const validBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!validBase64.test(value)) throw new Error("invalid_template_artifact");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new Error("invalid_template_artifact");
  }
  return decoded;
}

function validateAssetSet(template: AdTemplateParsed, assets: ArtifactAsset[]): Map<string, Buffer> {
  const declaredKeys = Object.keys(template.assets);
  const suppliedKeys = assets.map((asset) => asset.assetKey);
  if (
    new Set(suppliedKeys).size !== suppliedKeys.length ||
    declaredKeys.length !== suppliedKeys.length ||
    declaredKeys.some((key) => !suppliedKeys.includes(key))
  ) {
    throw new Error("template_artifact_assets_mismatch");
  }

  const bytesByKey = new Map<string, Buffer>();
  for (const asset of assets) {
    const declaration = template.assets[asset.assetKey];
    if (
      !declaration ||
      declaration.fileName !== asset.fileName ||
      declaration.mimeType !== asset.mimeType
    ) {
      throw new Error("template_artifact_assets_mismatch");
    }
    bytesByKey.set(asset.assetKey, decodeBase64Strict(asset.bytesBase64));
  }
  return bytesByKey;
}

function metadataFor(templateId: string, asset: ArtifactAsset): StoredAssetRow {
  return {
    asset_key: asset.assetKey,
    file_name: asset.fileName,
    mime_type: asset.mimeType,
    storage_path: storagePath(templateId, asset.assetKey, asset.fileName),
  };
}

async function storedBytes(supabase: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(ARTIFACT_BUCKET).download(path);
  if (error || !data) failConflict();

  const value = data as unknown;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  const arrayBuffer = (value as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof arrayBuffer !== "function") failConflict();
  return Buffer.from(await arrayBuffer.call(value));
}

async function assertExactReplay(
  supabase: SupabaseClient,
  template: AdTemplateParsed,
  assets: ArtifactAsset[],
  bytesByKey: Map<string, Buffer>,
  existingTemplateJson: unknown,
): Promise<void> {
  if (!isDeepStrictEqual(existingTemplateJson, template)) failConflict();

  const { data, error } = await supabase
    .from("ad_template_assets_direct")
    .select("asset_key, file_name, mime_type, storage_path")
    .eq("template_id", template.templateId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as StoredAssetRow[];
  if (rows.length !== assets.length || new Set(rows.map((row) => row.asset_key)).size !== rows.length) {
    failConflict();
  }
  const rowByKey = new Map(rows.map((row) => [row.asset_key, row]));
  for (const asset of assets) {
    const expected = metadataFor(template.templateId, asset);
    if (!isDeepStrictEqual(rowByKey.get(asset.assetKey), expected)) failConflict();
    const existingBytes = await storedBytes(supabase, expected.storage_path);
    if (!existingBytes.equals(bytesByKey.get(asset.assetKey)!)) failConflict();
  }
}

function isFinalizeConflict(error: { message?: string; code?: string }): boolean {
  return (
    error.code === "P0001" ||
    /template_artifact_(?:asset_)?(?:conflict|set_incomplete|invalid)/.test(error.message ?? "")
  );
}

async function finalizeMetadata(
  supabase: SupabaseClient,
  template: AdTemplateParsed,
  metadata: StoredAssetRow[],
): Promise<{ replayed: boolean; assetCount: number }> {
  const { data, error } = await supabase.rpc("finalize_ad_template_artifact", {
    p_template_id: template.templateId,
    p_template_json: template,
    p_assets: metadata,
  });
  if (error) {
    if (isFinalizeConflict(error)) failConflict();
    throw new Error(error.message);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { replayed?: boolean; asset_count?: number }
    | null;
  if (!row || typeof row.replayed !== "boolean" || row.asset_count !== metadata.length) {
    throw new Error("template_artifact_finalize_failed");
  }
  return { replayed: row.replayed, assetCount: row.asset_count };
}

async function removeNewUploads(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(ARTIFACT_BUCKET).remove(paths);
}

export async function ingestTemplateArtifact(
  supabase: SupabaseClient,
  input: unknown,
): Promise<IngestTemplateArtifactResult> {
  const parsed = directArtifactSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_template_artifact");

  const { template, assets } = parsed.data;
  const bytesByKey = validateAssetSet(template, assets);
  const metadata = assets.map((asset) => metadataFor(template.templateId, asset));

  const { data: existing, error: existingError } = await supabase
    .from("ad_templates")
    .select("template_json")
    .eq("template_id", template.templateId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    await assertExactReplay(
      supabase,
      template,
      assets,
      bytesByKey,
      (existing as { template_json: unknown }).template_json,
    );
    const finalized = await finalizeMetadata(supabase, template, metadata);
    if (!finalized.replayed) failConflict();
    return { templateId: template.templateId, assetCount: finalized.assetCount, replayed: true };
  }

  const uploadedByThisCall: string[] = [];
  try {
    for (const asset of assets) {
      const path = storagePath(template.templateId, asset.assetKey, asset.fileName);
      const { error } = await supabase.storage.from(ARTIFACT_BUCKET).upload(
        path,
        bytesByKey.get(asset.assetKey)!,
        { contentType: asset.mimeType, upsert: false },
      );
      if (error) {
        if (/already exists|duplicate|conflict/i.test(error.message)) {
          const existingBytes = await storedBytes(supabase, path);
          if (!existingBytes.equals(bytesByKey.get(asset.assetKey)!)) failConflict();
          continue;
        }
        throw new Error(error.message);
      }
      uploadedByThisCall.push(path);
    }

    const finalized = await finalizeMetadata(supabase, template, metadata);
    return {
      templateId: template.templateId,
      assetCount: finalized.assetCount,
      replayed: finalized.replayed,
    };
  } catch (error) {
    await removeNewUploads(supabase, uploadedByThisCall);
    throw error;
  }
}
