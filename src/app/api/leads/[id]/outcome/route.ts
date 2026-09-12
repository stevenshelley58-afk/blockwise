import { NextResponse, type NextRequest } from "next/server";

import { cancelObsoleteLeadNotices } from "@/lib/notifications/lead-notices.ts";
import { optionalNumber, optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { outcome?: unknown; reason?: unknown };

/** POST /api/leads/[id]/outcome - mark Won or Lost. Lost requires a reason. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
  const reason = optionalString(body.reason);

  if (outcome !== "Won" && outcome !== "Lost") {
    return NextResponse.json({ error: "outcome must be Won or Lost." }, { status: 400 });
  }
  if (outcome === "Lost" && !reason) {
    return NextResponse.json({ error: "A reason is required when marking an enquiry Lost." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "outcome",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.markOutcome({
        commandId,
        actor,
        lead: id,
        outcome,
        reason,
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
        reason: "terminal_stage",
      });
    },
  });
}
