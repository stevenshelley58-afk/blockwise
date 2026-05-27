import { NextResponse } from "next/server";

import { getLeadRowsWithDedupe } from "@/lib/product/workflow-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getLeadRowsWithDedupe());
}
