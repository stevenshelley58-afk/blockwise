import { NextResponse, type NextRequest } from "next/server";

import { runAdStudioComplianceReview } from "@/modules/adstudio";
import { getAdStudioDemoBundle } from "@/modules/adstudio/demo-data";
import { readJsonBody, requireAdStudioRequest } from "@/modules/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Partial<ReturnType<typeof getAdStudioDemoBundle>["campaignPack"]>>(request);
  const demo = getAdStudioDemoBundle().campaignPack;
  const report = runAdStudioComplianceReview({
    campaign: body.campaign ?? demo.campaign,
    copyPacks: body.copyPacks ?? demo.copyPacks,
  });

  return NextResponse.json({ report });
}
