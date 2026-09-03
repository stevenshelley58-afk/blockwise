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
  const suppliedKey = request.headers.get("Idempotency-Key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "");
  const key = suppliedKey.trim() || undefined;
  if (key && !/^[a-z0-9-]{20,200}$/i.test(key)) {
    return NextResponse.json({ error: "Idempotency-Key must be a valid opaque key." }, { status: 400 });
  }
  const pack = await getTemplate(access.supabase, templateId);
  if (!pack) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  try {
    const ad = await createCustomerAd(access.supabase, access.access.workspaceId, pack, key);
    return NextResponse.json(ad, { status: 201 });
  } catch (error) {
    console.error("[adstudio] customer ad creation failed", { workspaceId: access.access.workspaceId, templateId });
    return NextResponse.json({ error: "Could not create ad. Please try again." }, { status: 500 });
  }
}
