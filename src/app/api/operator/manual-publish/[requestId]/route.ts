import { NextResponse, type NextRequest } from "next/server";
import { requireOperator } from "@/lib/operator/auth";
import { ManualPublishError, getManualPublishRequest, updateManualPublishStatus, type ManualPublishStatus } from "@/lib/adstudio/manual-publish";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requestId: string }> | { requestId: string } };

export async function GET(_request: NextRequest, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { requestId } = await Promise.resolve(context.params);
  try {
    const result = await getManualPublishRequest(createSupabaseServiceClient(), { mutationId: requestId });
    return result ? NextResponse.json({ request: result }) : NextResponse.json({ error: "Manual publishing request was not found." }, { status: 404 });
  } catch (error) { return manualError(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { requestId } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as { status?: unknown; reason?: unknown };
  if (!(["requested", "in_progress", "completed", "cancelled"] as string[]).includes(String(body.status))) return NextResponse.json({ error: "Invalid manual publishing status." }, { status: 400 });
  try {
    const result = await updateManualPublishStatus({ serviceSupabase: createSupabaseServiceClient(), requestId, status: body.status as ManualPublishStatus, reason: typeof body.reason === "string" ? body.reason : "", actorProfileId: auth.userId });
    return NextResponse.json({ request: result });
  } catch (error) { return manualError(error); }
}

function manualError(error: unknown) {
  if (error instanceof ManualPublishError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("Manual publish operator request failed", error);
  return NextResponse.json({ error: "Manual publishing request failed." }, { status: 500 });
}
