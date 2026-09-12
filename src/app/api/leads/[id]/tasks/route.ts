import { NextResponse, type NextRequest } from "next/server";

import { optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { title?: unknown; purpose?: unknown; dueAt?: unknown; assignee?: unknown };

/** POST /api/leads/[id]/tasks - create a task on an enquiry. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const title = optionalString(body.title);

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  return runLeadMutation({
    request,
    action: "create-task",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.createTask({
        commandId,
        actor,
        lead: id,
        title,
        purpose: optionalString(body.purpose) ?? "other",
        dueAt: optionalString(body.dueAt),
        assignee: optionalString(body.assignee),
      }),
  });
}
