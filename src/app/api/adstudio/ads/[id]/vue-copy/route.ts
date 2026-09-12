import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";
import { copyAdToNativeTrial, NativeCopyError } from "@/lib/adstudio/vue-native-copy";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);
  try {
    const ad = await copyAdToNativeTrial({
      supabase: access.supabase,
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: access.access.workspaceId,
      sourceAdId: id,
    });
    return NextResponse.json({ ad }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof NativeCopyError) {
      const status = error.code === "source_ad_not_found" || error.code === "template_not_found" ? 404 : error.code.endsWith("_failed") ? 500 : 400;
      if (status >= 500) console.error("Native Ad Studio copy failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: status >= 500 ? "We could not create the native editor trial." : error.message, code: error.code }, { status });
    }
    return errorResponse(error);
  }
}
