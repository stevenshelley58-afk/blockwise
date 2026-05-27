import { NextResponse } from "next/server";

import { agentRuns } from "@/lib/product/demo-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ agentRuns });
}
