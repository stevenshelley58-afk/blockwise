import { NextResponse } from "next/server";

import { approvalQueue } from "@/lib/product/demo-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ approvals: approvalQueue });
}
