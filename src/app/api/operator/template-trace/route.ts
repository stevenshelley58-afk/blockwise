import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { listTemplateTraces } from "@/lib/operator/template-trace";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  return NextResponse.json({ templates: listTemplateTraces() });
}
