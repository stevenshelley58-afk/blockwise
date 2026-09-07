import type { SupabaseClient } from "@supabase/supabase-js";
import { renderBoth } from "../../../packages/ad-template-renderer/src/renderer.ts";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types.ts";
import { getTemplateForInternalInspection, templateAssetStoragePath } from "./pack-gallery.ts";

const BUCKET = "workspace-artifacts";
const CURRENT_OBJECTIVES = new Set(["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION", "OUTCOME_SALES"]);

type AssetRow = { asset_key: string; file_name: string; mime_type: string; storage_path: string };

export type TemplateSmokeChecks = {
  passed: true;
  schema: true;
  generationReview: true;
  assets: { declared: number; loaded: number };
  placements: { feed: { width: 1080; height: 1350; rendered: true }; story: { width: 1080; height: 1920; rendered: true } };
  publishing: { objective: string; destination: string; claimsReady: true; fulfilmentReady: true };
};

async function asBuffer(value: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  const arrayBuffer = (value as { arrayBuffer?: () => Promise<ArrayBuffer> })?.arrayBuffer;
  if (typeof arrayBuffer !== "function") throw new Error("template_smoke_asset_unreadable");
  return Buffer.from(await arrayBuffer.call(value));
}

export async function loadTemplateAssets(template: AdTemplate, service: SupabaseClient): Promise<Record<string, Buffer>> {
  const declarations = Object.entries(template.assets);
  const { data, error } = await service.from("ad_template_assets_direct").select("asset_key,file_name,mime_type,storage_path").eq("template_id", template.templateId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AssetRow[];
  if (rows.length !== declarations.length) throw new Error("template_smoke_assets_incomplete");
  const byKey = new Map(rows.map((row) => [row.asset_key, row]));
  const result: Record<string, Buffer> = {};
  for (const [assetKey, declaration] of declarations) {
    const expectedPath = templateAssetStoragePath(template.templateId, assetKey, declaration.fileName);
    const row = byKey.get(assetKey);
    if (!row || row.file_name !== declaration.fileName || row.mime_type !== declaration.mimeType || row.storage_path !== expectedPath) throw new Error("template_smoke_asset_metadata_mismatch");
    const { data: stored, error: downloadError } = await service.storage.from(BUCKET).download(expectedPath);
    if (downloadError || !stored) throw new Error("template_smoke_asset_unavailable");
    result[assetKey] = await asBuffer(stored);
  }
  return result;
}

function assertPublicationContract(template: AdTemplate) {
  const publish = template.metadata.publishRequirements;
  if (!CURRENT_OBJECTIVES.has(publish.objective)) throw new Error("template_smoke_objective_invalid");
  if (publish.destination.required && publish.destination.kind === "none") throw new Error("template_smoke_destination_invalid");
  if (publish.instantForm.required && publish.destination.kind !== "instant_form") throw new Error("template_smoke_form_destination_invalid");
  if ((publish.claims ?? []).some((claim) => claim.evidenceRequired && !claim.evidenceReference?.trim())) throw new Error("template_smoke_claim_evidence_missing");
  if (publish.offer?.promise && (!publish.fulfilment?.required || !publish.fulfilment.deliveryMethod)) throw new Error("template_smoke_fulfilment_missing");
}

export async function smokeTestTemplate(service: SupabaseClient, templateId: string, runId: string): Promise<TemplateSmokeChecks> {
  const template = await getTemplateForInternalInspection(service, templateId);
  if (!template) throw new Error("template_review_not_found");
  if (!template.metadata.generationReview) throw new Error("template_smoke_generation_review_missing");
  assertPublicationContract(template);
  const assets = await loadTemplateAssets(template, service);
  const imageValues: Record<string, Buffer> = { ...assets };
  for (const input of template.imageInputs) {
    if (input.required !== false && !input.defaultAssetKey) throw new Error("template_smoke_required_image_default_missing");
    if (input.defaultAssetKey) imageValues[input.key] = assets[input.defaultAssetKey]!;
  }
  const textValues = Object.fromEntries(template.textInputs.map((input) => [input.key, input.placeholder]));
  const fontValues = Object.fromEntries(template.fonts.flatMap((font) => {
    const match = Object.entries(template.assets).find(([, declaration]) => declaration.fileName === font.file);
    return match && assets[match[0]] ? [[font.file, assets[match[0]]]] : [];
  }));
  const [feed, story] = await renderBoth({ template, imageValues, textValues, colourMap: template.semanticColours, fontValues });
  if (feed.width !== 1080 || feed.height !== 1350 || story.width !== 1080 || story.height !== 1920) throw new Error("template_smoke_placement_dimensions_invalid");
  const checks: TemplateSmokeChecks = {
    passed: true, schema: true, generationReview: true,
    assets: { declared: Object.keys(template.assets).length, loaded: Object.keys(assets).length },
    placements: { feed: { width: 1080, height: 1350, rendered: true }, story: { width: 1080, height: 1920, rendered: true } },
    publishing: { objective: template.metadata.publishRequirements.objective, destination: template.metadata.publishRequirements.destination.kind, claimsReady: true, fulfilmentReady: true },
  };
  const { error } = await service.rpc("record_ad_template_smoke_test", { p_template_id: templateId, p_review_run_id: runId, p_checks: checks });
  if (error) throw new Error(error.message);
  return checks;
}

export async function activateTemplate(service: SupabaseClient, templateId: string, runId: string) {
  const { data, error } = await service.rpc("activate_reviewed_ad_template", { p_template_id: templateId, p_review_run_id: runId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { library_status?: string } | null;
  if (row?.library_status !== "active") throw new Error("template_activation_failed");
  return { templateId, status: "active" as const };
}

export async function discardTemplate(service: SupabaseClient, templateId: string, runId: string, reason?: string) {
  const { data: row, error: readError } = await service.from("ad_templates").select("library_status,library_review_run_id").eq("template_id", templateId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return { templateId, status: "discarded" as const, replayed: true };
  if ((row as { library_status: string }).library_status === "active") throw new Error("template_discard_active_forbidden");
  const { count, error: customerError } = await service.from("ad_customer_ads").select("id", { count: "exact", head: true }).eq("template_id", templateId);
  if (customerError) throw new Error(customerError.message);
  if ((count ?? 0) > 0) throw new Error("template_discard_customer_ads_exist");
  const { error: markError } = await service.from("ad_templates").update({ library_status: "discarding", library_review_run_id: runId, library_reviewed_at: null, library_smoke_test_checks: { passed: false, discarded: true, reason: reason?.trim() || null } }).eq("template_id", templateId).neq("library_status", "active");
  if (markError) throw new Error(markError.message);
  const { data: assets, error: assetsError } = await service.from("ad_template_assets_direct").select("storage_path").eq("template_id", templateId);
  if (assetsError) throw new Error(assetsError.message);
  const paths = (assets ?? []).map((asset: { storage_path: string }) => asset.storage_path);
  if (paths.length) {
    const { error: storageError } = await service.storage.from(BUCKET).remove(paths);
    if (storageError) throw new Error(storageError.message);
  }
  const { error: deleteAssetsError } = await service.from("ad_template_assets_direct").delete().eq("template_id", templateId);
  if (deleteAssetsError) throw new Error(deleteAssetsError.message);
  const { error: deleteTemplateError } = await service.from("ad_templates").delete().eq("template_id", templateId);
  if (deleteTemplateError) throw new Error(deleteTemplateError.message);
  return { templateId, status: "discarded" as const, replayed: false };
}
