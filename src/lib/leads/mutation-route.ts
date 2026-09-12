/**
 * Shared mutation pipeline for the lead API routes.
 *
 * Workspace and actor come from the session, an idempotency key is required,
 * and a stale revision is reported as a 409 with the current revision so the
 * UI can refresh instead of overwriting a newer change.
 */

import { NextResponse, type NextRequest } from "next/server";

import type { CrmCommands } from "@/lib/crm/commands.ts";
import type { CrmMutationResult } from "@/lib/crm/types.ts";
import { isCrmConflict } from "@/lib/crm/errors.ts";
import {
  crmErrorResponse,
  leadCommandId,
  readIdempotencyKey,
  requireLeadApiContext,
  requireLeadWriteRole,
  type LeadApiContext,
} from "./api-context.ts";

export type LeadMutationBody = {
  workspaceId?: unknown;
  expectedRevision?: unknown;
  idempotencyKey?: unknown;
};

export async function runLeadMutation<T extends CrmMutationResult>(input: {
  request: NextRequest;
  action: string;
  body: LeadMutationBody;
  /** Enquiry id, used to report the current revision on a conflict. */
  leadId?: string | null;
  execute: (args: {
    context: LeadApiContext;
    commands: CrmCommands;
    workspaceId: string;
    actor: string;
    commandId: string;
  }) => Promise<T>;
  /** Runs only after the CRM accepted the command. */
  afterCommit?: (args: { context: LeadApiContext; result: T }) => Promise<void>;
}): Promise<NextResponse> {
  const requestedWorkspaceId = typeof input.body.workspaceId === "string" ? input.body.workspaceId : null;
  const guard = await requireLeadApiContext(input.request, requestedWorkspaceId);
  if (!guard.ok) return guard.response;

  const { context } = guard;
  const forbidden = requireLeadWriteRole(context.access);
  if (forbidden) return forbidden;

  const idempotencyKey = readIdempotencyKey(input.request, input.body);
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "An Idempotency-Key header (8-200 chars of A-Za-z0-9._:-) is required." },
      { status: 400 },
    );
  }

  const commandId = leadCommandId(input.action, context.access.workspaceId, idempotencyKey);

  try {
    const result = await input.execute({
      context,
      commands: context.commands,
      workspaceId: context.access.workspaceId,
      actor: context.actor,
      commandId,
    });

    if (input.afterCommit) {
      await input.afterCommit({ context, result });
    }

    return NextResponse.json({ ok: true, ...result, commandId });
  } catch (error) {
    if (isCrmConflict(error)) {
      const revision = await currentRevision(context, input.leadId ?? null);
      return crmErrorResponse(error, revision);
    }
    return crmErrorResponse(error);
  }
}

async function currentRevision(context: LeadApiContext, lead: string | null): Promise<number | null> {
  if (!lead) return null;
  try {
    const doc = await context.commands.getLead(lead);
    return doc.revision;
  } catch {
    return null;
  }
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
