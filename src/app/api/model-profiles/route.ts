import { NextResponse } from "next/server";

import { ensureOperatorSession, getModelControlViewData } from "@/modules/model-control/model-profile-store";
import { createSupabaseServerClient } from "@/modules/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const operator = await ensureOperatorSession(supabase);

  if (!operator.ok) {
    return NextResponse.json({ error: operator.error }, { status: operator.status });
  }

  return NextResponse.json(await getModelControlViewData(supabase));
}
