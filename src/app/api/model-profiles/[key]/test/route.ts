import { NextRequest, NextResponse } from "next/server";

import { validateModelProfileSelection } from "@/lib/ai/model-control-config";
import { testDirectModel } from "@/lib/ai/direct-model-test";
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

  try {
    const result = await testDirectModel(validation.option);

    return NextResponse.json({ ok: true, content: result.content });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Direct model test failed." },
      { status: 503 },
    );
  }
}
