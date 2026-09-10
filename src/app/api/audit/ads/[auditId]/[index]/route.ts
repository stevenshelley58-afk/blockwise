import { NextResponse, type NextRequest } from "next/server";

import { AUDIT_AD_COUNT, auditPreviewPath } from "@/lib/audit/audit-ad-engine";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "workspace-artifacts";

type RouteContext = { params: Promise<{ auditId: string; index: string }> };

/**
 * GET /api/audit/ads/[auditId]/[index]
 *
 * Streams one generated preview. Anonymous by design: the whole point of the
 * funnel is that a visitor sees finished ads before signing up. The route only
 * ever reads the exact object the generate step wrote for that audit id.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { auditId, index } = await context.params;
  const slot = Number(index);

  if (!AUDIT_ID.test(auditId) || !Number.isInteger(slot) || slot < 0 || slot >= AUDIT_AD_COUNT) {
    return new NextResponse("Not found", { status: 404 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage.from(BUCKET).download(auditPreviewPath(auditId, slot));
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=3600",
    },
  });
}
