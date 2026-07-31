import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { buildTemplateTrace } from "@/lib/operator/template-trace";
import { detectCloneRegions } from "@/lib/adstudio/clone-regions";
import { resolveCloneCopy } from "@/lib/adstudio/reference-clone";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/operator/template-trace/[id]/detect-regions
 * Body: { imageUrl?: string }  — data URL or absolute URL to analyze.
 *        Defaults to the template's sample image (read from disk).
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
  let imageUrl: string = body.imageUrl ?? "";

  // Default: read the sample from public/ and convert to data URL.
  if (!imageUrl) {
    const samplePath = join(resolve(process.cwd(), "public"), ...trace.sampleImagePath.slice(1).split("/"));
    if (!existsSync(samplePath)) {
      return NextResponse.json({ error: "Sample image not found on disk." }, { status: 404 });
    }
    const bytes = readFileSync(samplePath);
    const ext = samplePath.split(".").pop()?.toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    imageUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  }

  const expectedCopy = resolveCloneCopy(trace.template, {});
  const regions = await detectCloneRegions({
    workspaceId: "operator-trace",
    userId: guard.userId,
    imageUrl,
    expectedCopy,
    format: trace.template.format,
  });

  return NextResponse.json({ regions, count: regions.length });
}
