import { NextResponse, type NextRequest } from "next/server";

import { recordCustomerActivationMilestone } from "@/lib/activation/customer-activation";
import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaHelpPath = "setup_guide" | "book_onboarding" | "pre_purchase_call";

type MetaHelpBody = {
  workspaceId?: string;
  path?: string;
};

const RESUME_PATHS: Record<MetaHelpPath, string> = {
  setup_guide: "/settings#connections",
  book_onboarding: "/settings#onboarding",
  pre_purchase_call: "/settings#onboarding",
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as MetaHelpBody;
  const path = normalizeHelpPath(body.path);
  if (!path) {
    return NextResponse.json(
      { error: "Choose the Meta setup guide, onboarding booking, or a pre-purchase call." },
      { status: 400 },
    );
  }

  const guard = await requireApiWorkspace(request, "self_serve", body.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && guard.access.role !== "owner" && guard.access.role !== "admin") {
    return NextResponse.json({ error: "Only a workspace owner or admin can choose Meta setup help." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  await recordCustomerActivationMilestone({
    workspaceId: guard.access.workspaceId,
    milestone: "meta_help_selected",
    choice: path,
    serviceSupabase: service,
  });
  await recordWorkspaceFunnelEventBestEffort(service, {
    eventName: "meta_help_requested",
    workspaceId: guard.access.workspaceId,
    idempotencyKey: `meta:${guard.access.workspaceId}:help:${path}`,
    properties: { help_path: path },
  });

  return NextResponse.json({
    workspaceId: guard.access.workspaceId,
    path,
    resumePath: RESUME_PATHS[path],
  });
}

function normalizeHelpPath(value: string | undefined): MetaHelpPath | null {
  return value === "setup_guide" || value === "book_onboarding" || value === "pre_purchase_call"
    ? value
    : null;
}
