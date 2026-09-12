/**
 * Shared prologue for the lead API routes.
 *
 * The workspace and the acting member always come from the authenticated
 * session. A client-supplied workspace id is never trusted: it is only used to
 * select among the memberships the session actually holds.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import type { WorkspaceAccess } from "@/lib/auth/workspace-access";
import { createWorkspaceCrm } from "@/lib/crm/index.ts";
import { CRM_ERROR_STATUS, isCrmError, type CrmError } from "@/lib/crm/errors.ts";
import type { CrmCommands } from "@/lib/crm/commands.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service.ts";

export type LeadApiContext = {
  access: WorkspaceAccess;
  serviceSupabase: SupabaseClient;
  commands: CrmCommands;
  /** Opaque actor recorded on CRM activity rows. */
  actor: string;
};

export type LeadApiGuard =
  | { ok: true; context: LeadApiContext }
  | { ok: false; response: NextResponse };

const WRITE_ROLES = new Set(["owner", "admin", "member", "operator"]);

export async function requireLeadApiContext(
  request: NextRequest,
  workspaceId?: string | null,
): Promise<LeadApiGuard> {
  const guard = await requireApiWorkspace(request, "monitor", workspaceId);
  if (!guard.ok) return guard;

  if (!guard.access.workspaceId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No workspace membership was found." }, { status: 404 }),
    };
  }

  const serviceSupabase = createSupabaseServiceClient();

  try {
    const crm = await createWorkspaceCrm({
      supabase: serviceSupabase,
      workspaceId: guard.access.workspaceId,
    });

    return {
      ok: true,
      context: {
        access: guard.access,
        serviceSupabase,
        commands: crm.commands,
        actor: guard.access.userId,
      },
    };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: messageFor(error) }, { status: statusFor(error) }) };
  }
}

/**
 * The signed-in member's CRM identity. Frappe identifies a lead owner by user,
 * and the only stable cross-system handle Blockwise holds is the verified
 * member email from the workspace member record.
 */
export async function resolveMemberCrmIdentity(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
  profileId: string,
): Promise<string | null> {
  const { data } = await serviceSupabase
    .from("workspace_members")
    .select("profile_id, profiles(email)")
    .eq("workspace_id", workspaceId)
    .eq("profile_id", profileId)
    .maybeSingle();

  const row = data as
    | { profile_id?: string | null; profiles?: { email?: string | null } | Array<{ email?: string | null }> | null }
    | null;
  const profile = Array.isArray(row?.profiles) ? row?.profiles[0] : row?.profiles;
  return profile?.email?.trim().toLowerCase() || null;
}

export function requireLeadWriteRole(access: WorkspaceAccess): NextResponse | null {
  if (WRITE_ROLES.has(access.role)) return null;
  return NextResponse.json({ error: "Changing an enquiry requires member access or above." }, { status: 403 });
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

/**
 * Read the required idempotency key from the Idempotency-Key header or the
 * body. The key derives the CRM command id, so replaying a request with the
 * same key replays the stored command result instead of mutating twice.
 */
export function readIdempotencyKey(request: NextRequest, body: unknown): string | null {
  const fromHeader = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (fromHeader) return IDEMPOTENCY_KEY_PATTERN.test(fromHeader) ? fromHeader : null;

  const fromBody =
    body && typeof body === "object" && "idempotencyKey" in body
      ? String((body as { idempotencyKey?: unknown }).idempotencyKey ?? "").trim()
      : "";
  return IDEMPOTENCY_KEY_PATTERN.test(fromBody) ? fromBody : null;
}

/** Stable command id for one idempotency key and one action. */
export function leadCommandId(action: string, workspaceId: string, idempotencyKey: string): string {
  return "crm:" + action + ":" + workspaceId + ":" + idempotencyKey;
}

export function crmErrorResponse(error: unknown, revision?: number | null): NextResponse {
  if (isCrmError(error)) {
    const crmError = error as CrmError;
    return NextResponse.json(
      {
        error: crmError.message,
        code: crmError.code,
        ...(crmError.code === "conflict" ? { staleRevision: true, revision: revision ?? null } : {}),
      },
      { status: CRM_ERROR_STATUS[crmError.code] },
    );
  }

  console.error("[leads-api] unexpected failure", error);
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

function statusFor(error: unknown): number {
  return isCrmError(error) ? CRM_ERROR_STATUS[error.code] : 500;
}

function messageFor(error: unknown): string {
  if (isCrmError(error)) return error.message;
  return "The CRM is not available for this workspace.";
}
