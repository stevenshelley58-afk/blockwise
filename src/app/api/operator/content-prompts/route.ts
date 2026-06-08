import { NextResponse } from "next/server";

import { listPromptSets, listPromptTemplates } from "@/lib/content-engine";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const supabase = createSupabaseServiceClient();
  const [promptSets, promptTemplates] = await Promise.all([
    listPromptSets(supabase as never),
    listPromptTemplates(supabase as never),
  ]);

  return NextResponse.json({ promptSets, promptTemplates });
}

