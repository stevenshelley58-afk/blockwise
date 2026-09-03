import { NextResponse, type NextRequest } from "next/server";

import { ingestTemplateArtifact } from "@/lib/adstudio/ingest-artifact";
import {
  verifyInternalRequestSignature,
} from "@/lib/adstudio/internal-request-signature";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function internalAuthenticationError(status: 401 | 503, diagnostic?: string) {
  const includeDiagnostic = process.env.BLOCKWISE_INTERNAL_AUTH_DEBUG === "true";
  return NextResponse.json(
    {
      error: status === 503
        ? "Internal authentication unavailable."
        : "Internal authentication required.",
      ...(includeDiagnostic && diagnostic ? { diagnostic } : {}),
    },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let signatureFailure: string | undefined;
  const verifiedSignature = verifyInternalRequestSignature({
    body: rawBody,
    method: request.method,
    path: request.nextUrl.pathname,
    timestamp: request.headers.get("x-blockwise-timestamp"),
    nonce: request.headers.get("x-blockwise-nonce"),
    scope: request.headers.get("x-blockwise-scope"),
    signature: request.headers.get("x-blockwise-signature"),
    secret: process.env.BLOCKWISE_INTERNAL_AUTH_SECRET,
    onFailure: (reason) => { signatureFailure = reason; },
  });
  if (!verifiedSignature) {
    console.warn("Rejected signed internal template request.", {
      reason: signatureFailure,
      method: request.method,
      path: request.nextUrl.pathname,
      bodyBytes: Buffer.byteLength(rawBody),
    });
    return internalAuthenticationError(401, `signature:${signatureFailure ?? "unknown"}`);
  }

  const supabase = createSupabaseServiceClient();
  const { data: nonceClaimed, error: nonceError } = await supabase.rpc(
    "claim_blockwise_internal_request_nonce",
    {
      p_scope: verifiedSignature.scope,
      p_nonce: verifiedSignature.nonce,
      p_expires_at: verifiedSignature.expiresAt,
    },
  );
  if (nonceError) {
    console.error("Failed to claim internal request nonce.", nonceError);
    return internalAuthenticationError(503, "nonce:unavailable");
  }
  if (nonceClaimed !== true) {
    return internalAuthenticationError(401, `nonce:${typeof nonceClaimed}:${String(nonceClaimed)}`);
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try {
    const result = await ingestTemplateArtifact(supabase, body);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "template_artifact_failed";
    const status = code === "invalid_template_artifact" || code === "template_artifact_assets_mismatch" ? 422
      : code === "template_artifact_conflict" ? 409 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
