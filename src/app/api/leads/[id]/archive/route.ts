import { NextResponse, type NextRequest } from "next/server";

import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { optionalNumber, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** POST /api/leads/[id]/archive - archive an enquiry and stop its reminders. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as LeadMutationBody;

  return runLeadMutation({
    request,
    action: "archive",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.archive({
        commandId,
        actor,
        lead: id,
        expectedRevision: optionalNumber(body.expectedRevision),
      }),
    afterCommit: async ({ context: ctx, result }) => {
      for (const task of result.cancelledTasks ?? []) {
        await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
          workspaceId: ctx.access.workspaceId,
          task,
          reason: "task_cancelled",
        });
      }
      await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
        workspaceId: ctx.access.workspaceId,
        enquiry: id,
        reason: "archived",
      });
    },
  });
}
