import { NextResponse, type NextRequest } from "next/server";

import { adDocumentSchema } from "../../../../../../../packages/ad-template-contract/src/schema.ts";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { NativeSaveError, saveNativeAd } from "@/lib/adstudio/vue-native-save";
import { NativeEditorValidationError, type NativePngExport } from "@/lib/adstudio/vue-native-validation";
import { SaveError } from "@/lib/adstudio/save-ad";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type SaveBody = {
  document?: unknown;
  expectedRevision?: unknown;
  exports?: { feed?: NativePngExport; story?: NativePngExport };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);
  const body = await readJsonBody<SaveBody>(request);
  const parsed = adDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid ad document: ${parsed.error.issues[0]?.message ?? "unknown issue"}`, code: "invalid_document" }, { status: 400 });
  }
  if (!parsed.data.nativeEditor) {
    return NextResponse.json({ error: "Native editor data is required.", code: "native_editor_required" }, { status: 400 });
  }
  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ error: "expectedRevision must be a non-negative integer." }, { status: 400 });
  }
  if (!body.exports?.feed || !body.exports.story) {
    return NextResponse.json({ error: "Feed and Story PNG exports are required.", code: "native_export_invalid" }, { status: 400 });
  }

  try {
    const output = await saveNativeAd({
      supabase: access.supabase,
      templateSupabase: createSupabaseServiceClient(),
      workspaceId: access.access.workspaceId,
      adId: id,
      document: parsed.data,
      expectedRevision: body.expectedRevision,
      exports: { feed: body.exports.feed, story: body.exports.story },
    });
    return NextResponse.json({ ad: output }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof NativeSaveError || error instanceof NativeEditorValidationError || error instanceof SaveError) {
      const status = error.code === "ad_not_found" || error.code === "template_not_found"
        ? 404
        : error.code === "stale_revision" || error.code === "template_contract_mismatch"
          ? 409
          : error.code === "revision_commit_failed" || error.code === "render_upload_failed" || error.code === "active_revision_invalid"
            ? 500
            : 400;
      if (status >= 500) console.error("Native Ad Studio save failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: status >= 500 ? "We could not save this ad. Please try again." : error.message, code: error.code }, { status });
    }
    return errorResponse(error);
  }
}
