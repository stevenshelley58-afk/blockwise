import { NextResponse, type NextRequest } from "next/server";

import { optionalString, runLeadMutation, type LeadMutationBody } from "@/lib/leads/mutation-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type Body = LeadMutationBody & { type?: unknown; note?: unknown };

const EVENT_TYPES = ["email_app_launch_requested", "call_requested", "note"] as const;

/**
 * POST /api/leads/[id]/events - audit-only event.
 *
 * "Email lead" opens the agent's own mail app and records
 * `email_app_launch_requested` here. It never marks the enquiry contacted and
 * never completes a task: a launch cannot be verified from the server.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as Body;
  const type = typeof body.type === "string" ? body.type.trim() : "";

  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: "type must be one of " + EVENT_TYPES.join(", ") + "." },
      { status: 400 },
    );
  }

  return runLeadMutation({
    request,
    action: "event",
    body,
    leadId: id,
    execute: ({ commands, actor, commandId }) =>
      commands.recordEvent({
        commandId,
        actor,
        lead: id,
        type: type as (typeof EVENT_TYPES)[number],
        note: optionalString(body.note),
      }),
  });
}
