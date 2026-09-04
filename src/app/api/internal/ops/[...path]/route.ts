import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { loadCustomerDetail, loadCustomerSubresource, loadCustomerSummaries, OpsNotFoundError } from "@/lib/ops/customer-operations";
import { verifyInternalOpsSignature } from "@/lib/ops/internal-auth";
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
 */
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = verifyInternalOpsSignature({
    method: request.method,
    pathname: request.nextUrl.pathname,
    body: "",
    timestamp: request.headers.get("x-blockwise-timestamp"),
    signature: request.headers.get("x-blockwise-signature"),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error === "expired" ? "request_expired" : "internal_auth_required" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  // The service client is intentionally untyped (the generated Supabase
  // schema is not checked into the app). Keep the shared limiter's runtime
  // contract while avoiding generated-schema variance across CI builds.
  const limited = await checkRateLimit(service as never, null, "hermes", {
    bucket: "internal-ops-read",
    maxRequests: 600,
    windowSeconds: 60,
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  const { path = [] } = await context.params;
  try {
    if (path.length === 1 && path[0] === "customers") {
      const result = await loadCustomerSummaries({
        page: numberParam(request.nextUrl.searchParams.get("page"), 1),
        pageSize: numberParam(request.nextUrl.searchParams.get("pageSize"), 50),
        query: request.nextUrl.searchParams.get("query") ?? undefined,
        serviceSupabase: service,
      });
      return NextResponse.json({ data: result }, noStore());
    }
    if (path[0] !== "customers" || path.length < 2 || !path[1]) return notFound();
    const workspaceId = decodeURIComponent(path[1]);
    if (path.length === 2) {
      const result = await loadCustomerDetail(workspaceId, service);
      return result ? NextResponse.json({ data: result }, noStore()) : notFound();
    }
    if (path.length === 3) {
      const result = await loadCustomerSubresource(workspaceId, path[2], service);
      return result ? NextResponse.json({ data: result }, noStore()) : notFound();
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
