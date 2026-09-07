import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";
import { getTemplateForInternalInspection, templateAssetStoragePath } from "./pack-gallery.ts";
import { resolveCustomerImageValues } from "./customer-image-storage.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { SaveError } from "./save-ad.ts";

export async function resolveImageValues(
  document: AdDocumentParsed,
  workspaceId: string,
  adId: string,
  supabase: SupabaseClient,
): Promise<{ bytes: Record<string, Buffer>; refs: Record<string, string> }> {
  return resolveCustomerImageValues(document.sharedImageValues, workspaceId, adId, supabase, { requireFinalizedLedger: true });
}

type StoredTemplateAsset = { asset_key: string; file_name: string; mime_type: string; storage_path: string };

export async function resolveTemplateAssetValues(
  adId: string,
  workspaceId: string,
  service = createSupabaseServiceClient(),
import { SaveError } from "./save-ad.ts";
): Promise<Record<string, Buffer>> {
  const { data: ad, error: adError } = await service.from("ad_customer_ads").select("template_id").eq("id", adId).eq("workspace_id", workspaceId).single();
  if (adError || !ad?.template_id) throw new SaveError("ad_not_found", "Ad not found");
  const template = await getTemplateForInternalInspection(service, ad.template_id);
  if (!template) throw new SaveError("template_not_found", "Template not found");
  const declarations = Object.entries(template.assets);
  if (declarations.length === 0) return {};
  const { data: assets, error: assetError } = await service.from("ad_template_assets_direct").select("asset_key,file_name,mime_type,storage_path").eq("template_id", ad.template_id);
  if (assetError) throw new SaveError("template_asset_load_failed", "Template assets could not be loaded");
  const rows = (assets ?? []) as StoredTemplateAsset[];
  if (rows.length !== declarations.length) throw new SaveError("template_asset_missing", "Template asset is missing");
  const byKey = new Map(rows.map(asset => [asset.asset_key, asset]));
  const values: Record<string, Buffer> = {};
  for (const [assetKey, declaration] of declarations) {
    const asset = byKey.get(assetKey);
    const expectedPath = templateAssetStoragePath(template.templateId, assetKey, declaration.fileName);
    if (!asset || asset.file_name !== declaration.fileName || asset.mime_type !== declaration.mimeType || asset.storage_path !== expectedPath) throw new SaveError("template_asset_missing", "Template asset is missing");
    const { data, error } = await service.storage.from("workspace-artifacts").download(expectedPath);
    if (error || !data) throw new SaveError("template_asset_missing", "Template asset is missing");
    values[assetKey] = Buffer.from(await data.arrayBuffer());
  }
  for (const input of template.imageInputs) {
    if (input.defaultAssetKey) {
      const defaultBytes = values[input.defaultAssetKey];
      if (!defaultBytes) throw new SaveError("template_asset_missing", "Template asset is missing");
      values[input.key] = defaultBytes;
    }
  }
  return values;
}

