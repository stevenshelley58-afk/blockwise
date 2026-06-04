import { NextResponse } from "next/server";

import { queueContentRun, rerunBodySchema } from "@/lib/content-engine";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(req: Request, context: RouteContext) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = rerunBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id } = await Promise.resolve(context.params);
  const serviceSupabase = createSupabaseServiceClient();
  const { data: run, error } = await serviceSupabase
    .from("content_runs")
    .select("id,workspace_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !run) {
    return NextResponse.json({ error: error?.message ?? "Content run was not found." }, { status: 404 });
  }

  const queued = await queueContentRun({
    workspaceId: String(run.workspace_id),
    runId: id,
    fromStep: parsed.data.fromStep,
  });

  return NextResponse.json({ triggerRunId: queued.id ?? null });
}

