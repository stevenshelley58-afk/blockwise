import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = ["not_started", "fast_path", "full_setup", "complete"] as const;

type OnboardingStatus = (typeof ALLOWED_STATUSES)[number];

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return typeof value === "string" && ALLOWED_STATUSES.includes(value as OnboardingStatus);
}

function normalizeStatus(value: unknown): OnboardingStatus {
  return isOnboardingStatus(value) ? value : "not_started";
}

function canTransition(current: OnboardingStatus, next: OnboardingStatus): boolean {
  if (current === next) return true;
  if (current === "complete") return false;
  return true;
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const body = (await request.json().catch(() => null)) as { status?: unknown; workspaceId?: unknown } | null;
  const nextStatus = body?.status;

  if (!isOnboardingStatus(nextStatus)) {
    return NextResponse.json({ error: "status must be not_started, fast_path, full_setup, or complete." }, { status: 400 });
  }

  const requestedWorkspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : request.nextUrl.searchParams.get("workspaceId");
  const access = await requireWorkspaceAccess(supabase, {
    surface: "self_serve",
    requestedWorkspaceId,
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: workspace, error: readError } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", access.access.workspaceId)
    .maybeSingle();

  if (readError || !workspace) {
    return NextResponse.json({ error: readError?.message ?? "Workspace was not found." }, { status: readError ? 500 : 404 });
  }

  const currentStatus = normalizeStatus((workspace as { onboarding_status?: unknown }).onboarding_status);

  if (!canTransition(currentStatus, nextStatus)) {
    return NextResponse.json(
      { error: `Cannot move onboarding status from ${currentStatus} to ${nextStatus}.`, onboardingStatus: currentStatus },
      { status: 409 },
    );
  }

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({ onboarding_status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", access.access.workspaceId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ onboardingStatus: nextStatus, workspaceId: access.access.workspaceId });
}
