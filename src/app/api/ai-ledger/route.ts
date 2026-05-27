import { NextResponse } from "next/server";

import { getAiLedgerRows } from "@/lib/product/workflow-data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ ledger: getAiLedgerRows() });
}
