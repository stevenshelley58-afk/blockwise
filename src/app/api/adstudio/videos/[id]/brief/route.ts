import { NextResponse, type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/adstudio/http";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { assessBriefCompleteness, BRIEF_ISSUE_MESSAGES, type BriefInput } from "@/lib/adstudio/video-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The commissioned video brief, autosaved.
 *
 * Autosave writes the customer's single working draft, so an interrupted
 * session never loses the brief. The draft stays editable until the customer
 * submits it, at which point an order freezes it and it is never updated again.
 *
 * This route cannot start a payment. It records what the customer wants, and
 * nothing more.
 */

type BriefBody = {
  workspaceId?: string;
  objective?: string;
  audience?: string;
  desiredAction?: string;
  keyFacts?: string;
  overlayWording?: string;
  wantsWordingHelp?: boolean;
  transcript?: string;
  referenceUrl?: string;
  musicPreference?: string;
  uploadPermissionConfirmed?: boolean;
};

const TEXT_LIMITS: Array<[keyof BriefBody, number]> = [
  ["objective", 500],
  ["audience", 500],
  ["desiredAction", 500],
  ["keyFacts", 2000],
  ["overlayWording", 500],
  ["transcript", 20000],
];

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const projectId = (request.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "A video is required." }, { status: 400 });

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("video_brief_versions")
    .select("*")
    .eq("workspace_id", guard.access.workspaceId)
    .eq("project_id", projectId)
    .is("frozen_at", null)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Your brief could not be loaded." }, { status: 500 });
  return NextResponse.json({ brief: data ?? null });
}

export async function PUT(request: NextRequest) {
  const body = await readJsonBody<BriefBody>(request);
  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? undefined);
  if (!guard.ok) return guard.response;

  const { access } = guard;
  const workspaceId = access.workspaceId;
  const projectId = (request.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "A video is required." }, { status: 400 });

  const limited = await checkRateLimit(workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "video-brief-save",
  });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const service = createSupabaseServiceClient();

  // The project must belong to this workspace and be a commissioned one.
  const { data: project } = await service
    .from("video_projects")
    .select("id, mode, workspace_id")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "That video was not found." }, { status: 404 });
  if (project.mode !== "commissioned") {
    return NextResponse.json({ error: "This video is not a commissioned order." }, { status: 400 });
  }

  const referenceUrl = clean(body.referenceUrl, 500);
  if (referenceUrl && !/^https?:\/\//i.test(referenceUrl)) {
    // Stored as text and never fetched by the server.
    return NextResponse.json({ error: "That reference must be a web address." }, { status: 400 });
  }

  const { count: assetCount } = await service
    .from("video_assets")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("visibility", "customer")
    .eq("upload_state", "ready");

  const draft: Record<string, unknown> = {
    workspace_id: workspaceId,
    project_id: projectId,
    objective: clean(body.objective, 500),
    audience: clean(body.audience, 500),
    desired_action: clean(body.desiredAction, 500),
    key_facts: clean(body.keyFacts, 2000),
    overlay_wording: clean(body.overlayWording, 500),
    wants_wording_help: body.wantsWordingHelp === true,
    transcript: clean(body.transcript, 20000),
    reference_url: referenceUrl,
    music_preference:
      body.musicPreference === "customer_supplied" || body.musicPreference === "none"
        ? body.musicPreference
        : "house_licensed",
    upload_permission_confirmed: body.uploadPermissionConfirmed === true,
    // frozen_at stays null: submitting is what freezes it.
    frozen_at: null,
    created_by: access.userId,
  };

  // Report completeness as the customer types, so they can fix an omission
  // before reaching the payment decision rather than after.
  const issues = assessBriefCompleteness({
    objective: draft.objective as string | null,
    audience: draft.audience as string | null,
    desiredAction: draft.desired_action as string | null,
    keyFacts: draft.key_facts as string | null,
    overlayWording: draft.overlay_wording as string | null,
    wantsWordingHelp: draft.wants_wording_help as boolean,
    uploadPermissionConfirmed: draft.upload_permission_confirmed as boolean,
    assetCount: assetCount ?? 0,
  } satisfies BriefInput);

  draft.is_complete = issues.length === 0;
  draft.completeness_issues = issues;

  // Update the one unfrozen draft, or create it. A partial unique index on
  // (project_id) where frozen_at is null is what actually guarantees there is
  // only ever one, so a concurrent save cannot produce a second working copy
  // and the frozen history is untouched.
  const { data: existingDraft, error: readError } = await service
    .from("video_brief_versions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .is("frozen_at", null)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: "Your brief could not be saved." }, { status: 500 });

  if (existingDraft) {
    const { error } = await service
      .from("video_brief_versions")
      .update(draft)
      .eq("id", existingDraft.id)
      .eq("workspace_id", workspaceId)
      .is("frozen_at", null);
    if (error) return NextResponse.json({ error: "Your brief could not be saved." }, { status: 500 });
  } else {
    const { error } = await service
      .from("video_brief_versions")
      .insert({ ...draft, version: 1 });
    // 23505 means another save won the race and created the draft; the next
    // autosave will update it, which is the correct outcome either way.
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: "Your brief could not be saved." }, { status: 500 });
    }
  }

  return NextResponse.json({
    saved: true,
    isComplete: issues.length === 0,
    issues,
    issueMessages: issues.map((issue) => BRIEF_ISSUE_MESSAGES[issue]),
  });
}
