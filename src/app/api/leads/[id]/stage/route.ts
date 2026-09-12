import { NextResponse, type NextRequest } from "next/server";

import { CRM_STAGES, type CrmStage } from "@/lib/crm/types.ts";
import { optionalNumber, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";
import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { isCrmTerminalStage } from "@/lib/crm/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { stage?: unknown };

/** POST /api/leads/[id]/stage - canonical stage change with a revision check. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";

  if (!(CRM_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json({ error: "stage must be one of " + CRM_STAGES.join(", ") + "." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "set-stage",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.setStage({
        commandId,
        actor,
        lead: id,
        stage: stage as CrmStage,
        expectedRevision: optionalNumber(body.expectedRevision),
      }),
    afterCommit: async ({ context: ctx, result }) => {
      if (isCrmTerminalStage(result.stage)) {
        await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
          workspaceId: ctx.access.workspaceId,
          enquiry: id,
          reason: "terminal_stage",
        });
      }
    },
  });
}
