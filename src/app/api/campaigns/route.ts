import { NextResponse } from "next/server";

import { getCampaignReadinessRows } from "@/lib/product/workflow-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ campaigns: getCampaignReadinessRows() });
}
