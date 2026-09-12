import { NextResponse, type NextRequest } from "next/server";

import { CRM_STAGES, type CrmStage } from "@/lib/crm/types.ts";
import { optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { stage?: unknown; reason?: unknown };

/**
 * POST /api/leads/[id]/reopen - explicit reopen with a reason and a chosen
 * stage. Cancelled tasks and old notices are never resurrected automatically.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  const reason = optionalString(body.reason);

  if (!(CRM_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json({ error: "stage must be one of " + CRM_STAGES.join(", ") + "." }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "A reason is required to reopen an enquiry." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "reopen",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.reopen({ commandId, actor, lead: id, stage: stage as CrmStage, reason }),
  });
}
