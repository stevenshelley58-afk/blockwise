import { NextResponse } from "next/server";

import { getModelControlViewData } from "@/lib/ai/model-profile-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  return NextResponse.json(await getModelControlViewData(supabase));
}
