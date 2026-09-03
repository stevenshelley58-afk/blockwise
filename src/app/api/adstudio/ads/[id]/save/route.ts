import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { getTemplate, templateAssetStoragePath } from "@/lib/adstudio/pack-gallery";
import { saveAd, SaveError } from "@/lib/adstudio/save-ad";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { adDocumentSchema, type AdDocumentParsed } from "../../../../../../../packages/ad-template-contract/src/schema.ts";
import { containsInlineImageData, } from "@/lib/adstudio/persisted-document";
import { CustomerImageStorageError, resolveCustomerImageValues } from "@/lib/adstudio/customer-image-storage";
import { metaCopyLimitIssues } from "@/lib/adstudio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type SaveBody = {
  document?: unknown;
  expectedRevision?: unknown;
};

/**
 * POST /api/adstudio/ads/[id]/save?workspaceId=...
 *
 * Persists a customer AdDocument as a new revision and renders Feed + Story
 * PNGs through saveAd. Returns both PNG hashes. Workspace-scoped: the ad row
 * must belong to the caller's workspace. Rejects stale revisions (409) so two
 * editors can't silently overwrite each other.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<SaveBody>(request);

  const parsed = adDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ad document: " + parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ error: "expectedRevision must be a non-negative integer." }, { status: 400 });
  }

  const document = parsed.data as AdDocumentParsed;
  const metaCopyIssue = metaCopyLimitIssues({
    primaryText: document.metaPrimaryText,
    headline: document.metaHeadline,
    description: document.metaDescription,
    cta: document.metaCta,
  })[0];
  if (metaCopyIssue) {
    return NextResponse.json(
      { error: `${metaCopyIssue.field} must be ${metaCopyIssue.maxLength} characters or fewer.`, code: "meta_copy_too_long" },
      { status: 400 },
    );
  }
  if (containsInlineImageData(document.sharedImageValues)) {
    return NextResponse.json(
      { error: "Upload images before saving this ad.", code: "image_upload_required" },
      { status: 400 },
    );
  }

  try {
    const [customerImages, templateAssets] = await Promise.all([
      resolveImageValues(document, access.access.workspaceId, id, createSupabaseServiceClient()),
      resolveTemplateAssetValues(id, access.access.workspaceId),
    ]);
    const persistedDocument = ({ ...document, sharedImageValues: customerImages.refs });
    const output = await saveAd({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      adId: id,
      document: persistedDocument,
      expectedRevision: body.expectedRevision,
      colourMap: document.resolvedColourMap,
      imageValues: { ...templateAssets, ...customerImages.bytes },
    });

    return NextResponse.json({ ad: output });
  } catch (err) {
    if (err instanceof CustomerImageStorageError) {
      return NextResponse.json(
        { error: err.kind === "invalid" ? `Image for input "${err.inputKey}" must be a valid PNG, JPEG, or WebP under 10 MB.` : "We could not store this image. Please try again.", code: err.kind === "invalid" ? "image_invalid" : "image_storage_failed" },
        { status: err.kind === "invalid" ? 400 : 500 },
      );
    }
    if (err instanceof SaveError) {
      const storageFailure = err.code.startsWith("template_asset") || err.code === "render_upload_failed";
      if (storageFailure) console.error("Ad Studio asset storage failure", { code: err.code, message: err.message });
      const status =
        err.code === "ad_not_found" || err.code === "template_not_found"
          ? 404
          : err.code === "stale_revision" || err.code === "template_hash_mismatch"
            ? 409
            : err.code.startsWith("image_") || err.code === "meta_copy_too_long"
              ? 400
              : 500;
      return NextResponse.json(
        { error: storageFailure ? "We could not finish rendering this ad. Please try again." : err.message, code: err.code },
        { status },
      );
    }
    return errorResponse(err);
  }
}

export async function resolveImageValues(
  document: AdDocumentParsed,
  workspaceId: string,
  adId: string,
  supabase: Parameters<typeof resolveCustomerImageValues>[3],
): Promise<{ bytes: Record<string, Buffer>; refs: Record<string, string> }> {
  return resolveCustomerImageValues(document.sharedImageValues, workspaceId, adId, supabase, { requireFinalizedLedger: true });
}

type StoredTemplateAsset = { asset_key: string; file_name: string; mime_type: string; storage_path: string };

export async function resolveTemplateAssetValues(adId: string, workspaceId: string): Promise<Record<string, Buffer>> {
  const service = createSupabaseServiceClient();
  const { data: ad, error: adError } = await service
    .from("ad_customer_ads")
    .select("template_id")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .single();
  if (adError || !ad?.template_id) throw new SaveError("ad_not_found", "Ad not found");

  const template = await getTemplate(service, ad.template_id);
  if (!template) throw new SaveError("template_not_found", "Template not found");
  const declarations = Object.entries(template.assets);
  if (declarations.length === 0) return {};

  const { data: assets, error: assetError } = await service
    .from("ad_template_assets_direct")
    .select("asset_key,file_name,mime_type,storage_path")
    .eq("template_id", ad.template_id);
  if (assetError) throw new SaveError("template_asset_load_failed", assetError.message);
  const rows = (assets ?? []) as StoredTemplateAsset[];
  if (rows.length !== declarations.length) throw new SaveError("template_asset_missing", "Template assets are incomplete.");
  const byKey = new Map(rows.map(asset => [asset.asset_key, asset]));

  const values: Record<string, Buffer> = {};
  for (const [assetKey, declaration] of declarations) {
    const asset = byKey.get(assetKey);
    const expectedPath = templateAssetStoragePath(template.templateId, assetKey, declaration.fileName);
    if (!asset || asset.file_name !== declaration.fileName || asset.mime_type !== declaration.mimeType || asset.storage_path !== expectedPath) {
      throw new SaveError("template_asset_missing", `Template asset ${assetKey} does not match its declaration.`);
    }
    const { data, error } = await service.storage.from("workspace-artifacts").download(expectedPath);
    if (error || !data) throw new SaveError("template_asset_missing", `Template asset ${assetKey} could not be loaded.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    values[assetKey] = bytes;
  }
  for (const input of template.imageInputs) {
    if (input.defaultAssetKey) {
      const defaultBytes = values[input.defaultAssetKey];
      if (!defaultBytes) throw new SaveError("template_asset_missing", `Default image for ${input.label} could not be loaded.`);
      values[input.key] = defaultBytes;
    }
  }
  return values;
}
