import { NextResponse, type NextRequest } from "next/server";

import { runAdStudioComplianceReview } from "@/lib/adstudio";
import type { AdStudioCampaignPack } from "@/lib/adstudio";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Partial<AdStudioCampaignPack>>(request);

  if (!body.campaign || !body.copyPacks) {
    return NextResponse.json(
      { error: "missing_required_fields", message: "campaign and copyPacks are required" },
      { status: 400 },
    );
  }

  const report = runAdStudioComplianceReview({
    campaign: body.campaign,
    copyPacks: body.copyPacks,
  });

  return NextResponse.json({ report });
}
