import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importTemplatePack } from "@/lib/adstudio/import-pack";

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
  if (!input.packUrl || !input.packSha256 || !input.packId || !input.issuedAt || !input.nonce || !input.signature) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const receipt = await importTemplatePack(supabase, {
      packUrl: String(input.packUrl),
      packSha256: String(input.packSha256),
      packId: String(input.packId),
      buildId: String(input.buildId ?? ""),
      issuedAt: String(input.issuedAt),
      nonce: String(input.nonce),
      signature: String(input.signature),
      idempotencyKey: String(input.idempotencyKey ?? input.packSha256),
    });

    const status = receipt.status === "replayed" ? 200 : 201;
    return NextResponse.json({ receipt }, { status });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string; detail?: unknown };
    const code = err.code ?? "import_failed";
    const status = code === "pack_id_conflict" ? 409
      : code === "nonce_replay" ? 409
      : code === "timestamp_expired" ? 400
      : code === "hash_mismatch" ? 400
      : code === "schema_invalid" ? 422
      : code === "origin_not_allowed" ? 403
      : 500;

    return NextResponse.json({ error: code, message: err.message, detail: err.detail }, { status });
  }
}
