import { NextResponse, type NextRequest } from "next/server";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { activateApprovedAdStudioPlan } from "@/lib/providers/adstudio-activation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const body = await readJsonBody<{ planId?: string; controlsFingerprint?: string; clientMutationKey?: string }>(request);
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  const controlsFingerprint = typeof body.controlsFingerprint === "string" ? body.controlsFingerprint.trim() : "";
  const clientMutationKey = typeof body.clientMutationKey === "string" ? body.clientMutationKey.trim() : "";
  if (!planId || !controlsFingerprint || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMutationKey)) {
    return NextResponse.json({ error: "activation_request_invalid" }, { status: 400 });
  }
  return activateApprovedAdStudioPlan({ adId: id, workspaceId: access.access.workspaceId,
    requestedBy: access.access.userId, planId, controlsFingerprint, clientMutationKey });
}
