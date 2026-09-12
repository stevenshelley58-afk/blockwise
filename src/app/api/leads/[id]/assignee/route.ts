import { NextResponse, type NextRequest } from "next/server";

import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { optionalNumber, optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { assignee?: unknown };

/**
 * POST /api/leads/[id]/assignee - reassign an enquiry and its open
 * prospecting tasks. The previous owner's pending notices are cancelled.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const assignee = optionalString(body.assignee);

  if (!assignee) {
    return NextResponse.json({ error: "assignee is required." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "reassign",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.reassign({
        commandId,
        actor,
        lead: id,
        assignee,
        expectedRevision: optionalNumber(body.expectedRevision),
      }),
    afterCommit: async ({ context: ctx }) => {
      await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
        workspaceId: ctx.access.workspaceId,
        enquiry: id,
        reason: "reassigned",
      });
    },
  });
}
