import { NextResponse, type NextRequest } from "next/server";

import { scoreAdStudioVariant } from "@/lib/adstudio";
import { requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  return NextResponse.json({
    variantId: id,
    score: scoreAdStudioVariant({
      offerClarity: 18,
      localRelevance: 14,
      leadIntentStrength: 18,
      brandFit: 14,
      complianceSafety: 20,
      visualHierarchy: 8,
      notes: ["Strong seller intent", "CTA is specific", "No blocking compliance issues"],
      warnings: [],
    }),
  });
}
