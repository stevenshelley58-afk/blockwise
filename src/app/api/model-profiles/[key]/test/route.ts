import { NextRequest, NextResponse } from "next/server";

import { validateModelProfileSelection } from "@/lib/ai/model-control-config";
import { ensureOperatorSession } from "@/lib/ai/model-profile-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ key: string }> | { key: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { key } = await Promise.resolve(context.params);
  const body = (await request.json()) as { provider?: unknown; model?: unknown };

  const supabase = await createSupabaseServerClient();
  const operator = await ensureOperatorSession(supabase);

  if (!operator.ok) {
    return NextResponse.json({ error: operator.error }, { status: operator.status });
  }

  const validation = validateModelProfileSelection(key, body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  return NextResponse.json({ ok: false, error: "Model testing is not configured." });
}
