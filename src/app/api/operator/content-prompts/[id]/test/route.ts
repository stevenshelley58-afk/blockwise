import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(_req: Request, context: RouteContext) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await Promise.resolve(context.params);
  const { data, error } = await createSupabaseServiceClient()
    .from("prompt_templates")
    .select("id,key,skill_name,version,template_body,status")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Prompt template was not found." }, { status: 404 });
  }

  return NextResponse.json({
    output: {
      mode: "prompt_test_preview",
      skill_name: data.skill_name,
      version: data.version,
      status: data.status,
      note: "Prompt preview renders and validates the selected template. Live comparison runs through content run generation.",
      rendered_excerpt: String(data.template_body).slice(0, 800),
    },
  });
}

