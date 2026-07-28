import { NextResponse } from "next/server";

import {
  createContentRunInputSchema,
  createContentRunRecord,
  listContentRuns,
  queueContentRun,
} from "@/lib/content-engine";
import { requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const access = await resolveOperatorWorkspace(guard.supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const runs = await listContentRuns(createSupabaseServiceClient() as never, access.workspaceId);
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = createContentRunInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const access = await resolveOperatorWorkspace(guard.supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const serviceSupabase = createSupabaseServiceClient();
  const run = await createContentRunRecord({
    supabase: serviceSupabase as never,
    workspaceId: access.workspaceId,
    operatorUserId: access.userId,
    body: parsed.data,
  });
  let queueJobId: string | null = null;
  let queueError: string | null = null;

  try {
    const queued = await queueContentRun({
      researchSupabase: createResearchServiceClient() as never,
      workspaceId: access.workspaceId,
      runId: run.id,
    });
    queueJobId = queued.id ?? null;
  } catch (error) {
    queueError = error instanceof Error ? error.message : "Unable to queue content run.";
  }

  return NextResponse.json({ run, queueJobId, triggerRunId: queueJobId, queueError }, { status: queueError ? 202 : 201 });
}

async function resolveOperatorWorkspace(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "unauthenticated" };

  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.workspace_id) {
    const fallback = await supabase.from("workspaces").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!fallback.data?.id) return { ok: false as const, status: 404, error: "No workspace was found." };
    return { ok: true as const, workspaceId: String(fallback.data.id), userId: user.id };
  }

  return { ok: true as const, workspaceId: String(data.workspace_id), userId: user.id };
}
