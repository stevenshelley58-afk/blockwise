import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { buildTemplateTrace } from "@/lib/operator/template-trace";
import { buildPrebuiltTemplateCloneQa } from "@/lib/adstudio/clone-regions";
import { resolveCloneCopy } from "@/lib/adstudio/reference-clone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/operator/template-trace/[id]/detect-regions
 *
 * Returns the editable text/image regions for a template. Customer generation
 * is fully deterministic: boxes are measured once offline from the approved
 * sample's type-spec and carried into each matching-format creative, so this
 * mirrors exactly what generation uses (no live vision call). Body (optional):
 * { format?: string } to preview regions mapped to another canvas (4:5 / 9:16).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const trace = buildTemplateTrace(decodeURIComponent(id));
  if (!trace) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const format = typeof body.format === "string" && body.format ? body.format : trace.template.format;

  const expectedCopy = resolveCloneCopy(trace.template, {});
  const qa = buildPrebuiltTemplateCloneQa(trace.template, expectedCopy, format);
  const regions = qa?.regions ?? [];

  return NextResponse.json({ regions, count: regions.length, copyValues: qa?.copyValues ?? expectedCopy });
}
