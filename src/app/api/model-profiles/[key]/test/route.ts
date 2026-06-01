import { NextRequest, NextResponse } from "next/server";

import { validateModelProfileSelection } from "@/modules/model-control/model-control-config";
import { ensureOperatorSession } from "@/modules/model-control/model-profile-store";
import { testOpenRouterModel } from "@/modules/model-control/openrouter-client";
import { resolveModelProfile } from "@/modules/model-control/model-registry";
import type { ModelProfileKey } from "@/modules/model-control/model-registry";
import { createSupabaseServerClient } from "@/modules/supabase/server";

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
    const profileKey = key as ModelProfileKey;
    const { profile } = resolveModelProfile(profileKey);
    const result = await testOpenRouterModel({
      model: validation.option.model,
      requireParameters: profile.requiresStructuredOutput,
    });

    return NextResponse.json({ ok: true, content: result.content });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OpenRouter test failed." },
      { status: 503 },
    );
  }
}
