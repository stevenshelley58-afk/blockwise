import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { loadCustomerDetail, loadCustomerSubresource, loadCustomerSummaries, loadPublicEnquiries, OpsNotFoundError } from "@/lib/ops/customer-operations";
import { verifyInternalRequest } from "@/lib/internal-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stable, service-only contract for Frank/Hermes. Every request is signed;
 * source-of-truth reads use the service role and responses are allowlisted by
 * customer-operations.ts. This route never calls Mautic, Chatwoot, Stripe, or
 * any other provider.
 *
 * GET /api/internal/ops/customers
 * GET /api/internal/ops/customers/:workspaceId
 * GET /api/internal/ops/customers/:workspaceId/{lifecycle,activity,email,enquiries,bookings,billing,projections}
 * GET /api/internal/ops/enquiries
 */
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const service = createSupabaseServiceClient();
  const auth = await verifyInternalRequest(request, "ops.read", { body: "", supabase: service });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, noStore(auth.status));
  }

  const limited = await checkRateLimit(null, "hermes", {
    bucket: "internal-ops-read",
    maxRequests: 600,
    windowSeconds: 60,
  }, service);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  const { path = [] } = await context.params;
  try {
    if (path.length === 1 && path[0] === "customers") {
      const result = await loadCustomerSummaries({
        cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        limit: numberParam(request.nextUrl.searchParams.get("limit"), numberParam(request.nextUrl.searchParams.get("pageSize"), 50)),
        query: request.nextUrl.searchParams.get("query") ?? undefined,
        serviceSupabase: service,
      });
      return NextResponse.json(readEnvelope(result, request.nextUrl.pathname), noStore());
    }
    if (path.length === 1 && path[0] === "enquiries") {
      const result = await loadPublicEnquiries({
        cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        limit: numberParam(request.nextUrl.searchParams.get("limit"), 50),
        serviceSupabase: service,
      });
      return NextResponse.json(readEnvelope(result, request.nextUrl.pathname), noStore());
    }
    if (path[0] !== "customers" || path.length < 2 || !path[1]) return notFound();
    const workspaceId = decodeURIComponent(path[1]);
    if (path.length === 2) {
      const result = await loadCustomerDetail(workspaceId, service);
      return result ? NextResponse.json(readEnvelope(result, request.nextUrl.pathname), noStore()) : notFound();
    }
    if (path.length === 3) {
      const result = await loadCustomerSubresource(workspaceId, path[2], service);
      return result ? NextResponse.json(readEnvelope(result, request.nextUrl.pathname), noStore()) : notFound();
    }
    return notFound();
  } catch (error) {
    if (error instanceof OpsNotFoundError) return notFound();
    console.error("[internal-ops] read failed", error);
    return NextResponse.json({ error: "ops_read_failed" }, noStore(500));
  }
}

function numberParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function noStore(status = 200): ResponseInit { return { status, headers: { "Cache-Control": "no-store" } }; }
function notFound() { return NextResponse.json({ error: "not_found" }, noStore(404)); }

function readEnvelope(data: unknown, pathname: string) {
  const generatedAt = new Date();
  const freshUntil = new Date(generatedAt.getTime() + 5 * 60_000).toISOString();
  const sourceReceiptIds = collectSourceReceipts(data, pathname);
  return {
    schema: "blockwise.ops.read.v1",
    project_id: "blockwise",
    generated_at: generatedAt.toISOString(),
    fresh_until: freshUntil,
    // Bind freshness to the deployed immutable revision when the host
    // provides one; the contract version is the deterministic local fallback.
    source_revision: process.env.BLOCKWISE_BUILD_REVISION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "blockwise-ops-read-v1",
    source_receipt_ids: sourceReceiptIds,
    data,
  };
}

function collectSourceReceipts(data: unknown, pathname: string): string[] {
  const ids: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || ids.length >= 100 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.id === "string" && row.id.length <= 64) ids.push(`receipt:ops/${pathname.replace(/^\/+/, "").replace(/[^A-Za-z0-9/_-]/g, "_")}/${row.id}`.slice(0, 128));
    for (const child of Object.values(row)) visit(child, depth + 1);
  };
  visit(data, 0);
  return [...new Set(ids.length ? ids : [`receipt:ops/${pathname.replace(/^\/+/, "").replace(/[^A-Za-z0-9/_-]/g, "_")}`])];
}
