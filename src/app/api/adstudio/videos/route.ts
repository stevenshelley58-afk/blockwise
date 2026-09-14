import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { readJsonBody } from "@/lib/adstudio/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's video projects.
 *
 * A project carries either an existing finished video the customer keeps, or a
 * commissioned edit they buy. This route creates and lists them. It never
 * creates a payment record: an uploaded video is free, and a commissioned order
 * is created separately by the checkout route.
 */

const MAX_TITLE = 160;

type CreateBody = {
  workspaceId?: string;
  mode?: string;
  title?: string;
};

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const { supabase, access } = guard;
  const workspaceId = access.workspaceId;

  const { data, error } = await supabase
    .from("video_projects")
    .select("id, mode, title, status, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("customer_visible", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: "Your videos could not be loaded." }, { status: 500 });
  }

  return NextResponse.json({ projects: data ?? [] });
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody<CreateBody>(request);
  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;

  const mode = body.mode === "commissioned" ? "commissioned" : body.mode === "uploaded" ? "uploaded" : null;
  if (!mode) {
    return NextResponse.json({ error: "Choose a video type." }, { status: 400 });
  }

  const title = (body.title ?? "").trim().slice(0, MAX_TITLE);
  if (title.length === 0) {
    return NextResponse.json({ error: "Give this video a name." }, { status: 400 });
  }

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 30,
    bucket: "video-project-create",
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  // video_assets and the brief tables are server-only, so the privileged client
  // is required. Workspace scope was already enforced above and is re-applied
  // to every statement here.
  const service = createSupabaseServiceClient();

  const { data: created, error } = await service
    .from("video_projects")
    .insert({
      workspace_id: workspaceId,
      mode,
      title,
      status: "draft",
      created_by: access.userId,
    })
    .select("id, mode, title, status, created_at")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: "That video could not be created." }, { status: 500 });
  }

  return NextResponse.json({ project: created }, { status: 201 });
}
