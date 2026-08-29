import { NextResponse, type NextRequest } from "next/server";

import { ingestTemplateArtifact } from "@/lib/adstudio/ingest-artifact";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function isAuthorizedInternalTemplateRequest(
  authorization: string | null,
  configuredSecret = process.env.BLOCKWISE_INTERNAL_AUTH_SECRET,
): boolean {
  const expected = configuredSecret?.trim();
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(expected && provided && provided === expected);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedInternalTemplateRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Internal authentication required." }, { status: 401 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try {
    const result = await ingestTemplateArtifact(createSupabaseServiceClient(), body);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "template_artifact_failed";
    const status = code === "invalid_template_artifact" || code === "template_artifact_assets_mismatch" ? 422
      : code === "template_artifact_conflict" ? 409 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
