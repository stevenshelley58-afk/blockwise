import { NextResponse, type NextRequest } from "next/server";

import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { optionalNumber, optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { kind?: unknown; note?: unknown; occurredAt?: unknown; nextFollowUpAt?: unknown };

/**
 * POST /api/leads/[id]/activities - agent-reported contact or reply.
 * A reply replaces the system first-contact task with a Respond task in the
 * CRM; Blockwise stores no second copy of either.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "";

  if (kind !== "contact" && kind !== "reply") {
    return NextResponse.json({ error: "kind must be contact or reply." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "activity-" + kind,
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      kind === "contact"
        ? commands.logContact({
            commandId,
            actor,
            lead: id,
            expectedRevision: optionalNumber(body.expectedRevision),
            note: optionalString(body.note),
            occurredAt: optionalString(body.occurredAt),
            nextFollowUpAt: optionalString(body.nextFollowUpAt),
          })
        : commands.logReply({
            commandId,
            actor,
            lead: id,
            expectedRevision: optionalNumber(body.expectedRevision),
            note: optionalString(body.note),
            occurredAt: optionalString(body.occurredAt),
          }),
    afterCommit: async ({ context: ctx, result }) => {
      // A completed first-contact task makes its reminder obsolete.
      for (const task of result.completedTasks ?? []) {
        await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
          workspaceId: ctx.access.workspaceId,
          task,
          reason: "task_completed",
        });
      }
    },
  });
}
