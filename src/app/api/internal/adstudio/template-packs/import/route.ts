import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importFrankPublicRelease } from "@/lib/adstudio/frank-public-release";

/**
 * POST /api/internal/adstudio/template-packs/import
 *
 * Internal endpoint — accepts signed TemplatePacks from Frank.
 * Not customer-facing. Auth via shared internal secret.
 */
export async function POST(request: Request) {
  // Auth: internal service secret
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.BLOCKWISE_INTERNAL_AUTH_SECRET ?? "dev-secret-change-me";
  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (!input.release || !input.nonce) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const receipt = await importFrankPublicRelease(supabase, {
      release: input.release,
      importRequest: {
        nonce: String(input.nonce),
        idempotencyKey: String(input.idempotencyKey ?? ""),
      },
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : undefined,
    });

    const status = receipt.status === "replayed" ? 200 : 201;
    return NextResponse.json({ receipt }, { status });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string; detail?: unknown };
    const code = err.code ?? "import_failed";
    const status = code === "pack_id_conflict" || code === "nonce_replay" ? 409
      : code === "origin_not_allowed" || code === "cross_workspace_data" ? 403
      : code === "schema_invalid" || code === "release_invalid" || code === "release_incompatible"
        || code === "sanitization_rejected" || code === "mutable_draft_rejected" || code === "unknown_asset"
        || code === "checksum_mismatch" || code === "checksum_invalid" || code === "artifact_binding_mismatch"
        || code === "pack_id_mismatch" || code === "qa_rejected" || code === "approval_required"
        || code === "provenance_missing" || code === "receipt_missing" ? 422
      : code === "timestamp_expired" || code === "hash_mismatch" || code === "import_request_invalid" ? 400
      : 500;

    return NextResponse.json({ error: code, message: err.message, detail: err.detail }, { status });
  }
}
