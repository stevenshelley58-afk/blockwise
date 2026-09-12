import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { saveAd, SaveError } from "@/lib/adstudio/save-ad";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { adDocumentSchema, type AdDocumentParsed } from "../../../../../../../packages/ad-template-contract/src/schema.ts";
import { containsInlineImageData, } from "@/lib/adstudio/persisted-document";
import { CustomerImageStorageError } from "@/lib/adstudio/customer-image-storage";
import { resolveImageValues as resolveImageValuesShared, resolveTemplateAssetValues as resolveTemplateAssetValuesShared } from "@/lib/adstudio/render-assets";
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
  if (document.nativeEditor) {
    return NextResponse.json(
      { error: "Use the native editor save action for this ad.", code: "native_editor_route_required" },
      { status: 409 },
    );
  }
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
    const serviceSupabase = createSupabaseServiceClient();
    const [customerImages, templateAssets] = await Promise.all([
      resolveImageValuesShared(document, access.access.workspaceId, id, serviceSupabase),
      resolveTemplateAssetValuesShared(id, access.access.workspaceId, serviceSupabase),
    ]);
    const persistedDocument = ({ ...document, sharedImageValues: customerImages.refs });
    const output = await saveAd({
      supabase: access.supabase,
      templateSupabase: serviceSupabase,
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
