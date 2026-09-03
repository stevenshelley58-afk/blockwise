import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest, readJsonBody } from "@/lib/adstudio/http";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicitly create a customer ad from a direct template. GET never creates rows. */
export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const body = await readJsonBody<{ templateId?: unknown; idempotencyKey?: unknown }>(request);
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId || templateId.length > 200) return NextResponse.json({ error: "A valid templateId is required." }, { status: 400 });
  const key = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 200) : undefined;
  const pack = await getTemplate(access.supabase, templateId);
  if (!pack) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  try {
    const ad = await createCustomerAd(access.supabase, access.access.workspaceId, pack, key);
    return NextResponse.json(ad, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create ad." }, { status: 500 });
  }
}
