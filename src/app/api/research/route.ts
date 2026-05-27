import { NextResponse } from "next/server";

import { competitorSignals } from "@/lib/product/demo-data";
import { getComplianceDemo } from "@/lib/product/workflow-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    signals: competitorSignals,
    complianceExamples: getComplianceDemo(),
  });
}
