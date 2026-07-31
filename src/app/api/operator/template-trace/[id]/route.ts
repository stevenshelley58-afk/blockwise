import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { buildTemplateTrace } from "@/lib/operator/template-trace";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const trace = buildTemplateTrace(decodeURIComponent(id));
  if (!trace) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  return NextResponse.json({ trace });
}
