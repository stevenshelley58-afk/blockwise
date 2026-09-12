import { NextResponse, type NextRequest } from "next/server";

import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { status?: unknown; dueAt?: unknown };

/**
 * PATCH /api/lead-tasks/[id] - complete or snooze one CRM task.
 *
 * `status: "Done"` completes it; `dueAt` moves the due time. Either change
 * makes a pending reminder for that task obsolete, so it is cancelled.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const status = optionalString(body.status);
  const dueAt = optionalString(body.dueAt);

  if (status === "Done" && dueAt) {
    return NextResponse.json({ error: "Send either status or dueAt, not both." }, { status: 400 });
  }
  if (status !== "Done" && !dueAt) {
    return NextResponse.json({ error: "status: Done or dueAt is required." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: status === "Done" ? "complete-task" : "snooze-task",
    body,
    execute: ({ commands, actor, commandId }) =>
      status === "Done"
        ? commands.completeTask({ commandId, actor, task: id })
        : commands.snoozeTask({ commandId, actor, task: id, dueAt: dueAt as string }),
    afterCommit: async ({ context: ctx }) => {
      await cancelObsoleteLeadNotices(ctx.serviceSupabase, {
        workspaceId: ctx.access.workspaceId,
        task: id,
        reason: status === "Done" ? "task_completed" : "task_snoozed",
      });
    },
  });
}
