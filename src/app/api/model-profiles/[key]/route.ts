import { NextRequest, NextResponse } from "next/server";

import { ensureOperatorSession, saveModelProfileSelection } from "@/lib/ai/model-profile-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }> | { key: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { key } = await Promise.resolve(context.params);
  const body = (await request.json()) as { provider?: unknown; model?: unknown };

  const supabase = await createSupabaseServerClient();
  const operator = await ensureOperatorSession(supabase);

  if (!operator.ok) {
    return NextResponse.json({ error: operator.error }, { status: operator.status });
  }

  const result = await saveModelProfileSelection(supabase, key, body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
