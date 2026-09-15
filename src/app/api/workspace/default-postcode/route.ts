import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { workspacePostcodeSchema } from "@/lib/workspace/default-postcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  postcode: z.unknown(),
}).strict();

export async function PATCH(request: NextRequest) {
  const requestBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!requestBody.success) {
    return NextResponse.json({ error: "The postcode request was not valid." }, { status: 400 });
  }
  const postcode = workspacePostcodeSchema.safeParse(requestBody.data.postcode);
  if (!postcode.success) {
    return NextResponse.json({ error: postcode.error.issues[0]?.message ?? "Enter a valid postcode." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "ad_studio", requestBody.data.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && guard.access.role !== "owner" && guard.access.role !== "admin") {
    return NextResponse.json({ error: "Only a workspace owner or admin can change the default postcode." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("workspaces")
    .update({ default_postcode: postcode.data, updated_at: new Date().toISOString() })
    .eq("id", guard.access.workspaceId)
    .select("default_postcode")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "The postcode could not be saved. Try again." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "The workspace was not found." }, { status: 404 });

  return NextResponse.json({ postcode: postcode.data }, { headers: { "cache-control": "no-store" } });
}
