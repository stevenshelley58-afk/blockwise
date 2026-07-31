import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { recordAuditLog } from "@/lib/supabase/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "member", "viewer"];

type InviteBody = { workspaceId?: string; email?: string; role?: string };
type CancelBody = { workspaceId?: string; invitationId?: string };
type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type ReservationOutcome =
  | "reserved"
  | "already_pending"
  | "already_member"
  | "seat_limit_reached"
  | "paid_plan_required"
  | "owner_required"
  | "invalid_email"
  | "invalid_role"
  | "invalid_member"
  | "workspace_not_found";

type Reservation = {
  outcome: ReservationOutcome;
  invitationId: string | null;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = (body.email ?? "").trim().toLowerCase();
  const role = (body.role ?? "member").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  const { access } = guard;

  if ((!access.isOperator && access.role !== "owner") || !canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Only the workspace owner can invite members." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const { data: reservationData, error: reservationError } = await service.rpc(
    "reserve_verified_workspace_invitation",
    {
      p_workspace_id: access.workspaceId,
      p_email: email,
      p_role: role,
      p_actor_profile_id: access.userId,
    },
  );
  if (reservationError) {
    return NextResponse.json({ error: reservationError.message }, { status: 500 });
  }

  const reservation = firstReservation(reservationData);
  if (!reservation) {
    return NextResponse.json({ error: "The seat reservation returned an invalid result." }, { status: 500 });
  }

  const rejection = reservationRejection(reservation.outcome);
  if (rejection) {
    return NextResponse.json({ error: rejection.message }, { status: rejection.status });
  }
  if (reservation.outcome === "already_member") {
    return NextResponse.json({ ok: true, message: `${email} is already a workspace member.` });
  }
  if (!reservation.invitationId) {
    return NextResponse.json({ error: "The seat reservation returned no invitation." }, { status: 500 });
  }

  const existingUser = await findUserByEmail(service, email);
  const redirectTo = invitationRedirect(request);
  const delivery = existingUser
    ? await service.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      })
    : await service.auth.admin.inviteUserByEmail(email, { redirectTo });

  const providerUserId = existingUser?.id
    ?? ("data" in delivery && delivery.data && "user" in delivery.data ? delivery.data.user?.id ?? null : null);
  const deliveryError = delivery.error?.message ?? null;

  const { error: deliveryStateError } = await service
    .from("workspace_invitations")
    .update({
      provider_user_id: providerUserId,
      send_attempt_count: 1,
      last_sent_at: deliveryError ? null : new Date().toISOString(),
      last_send_error: deliveryError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.invitationId)
    .eq("workspace_id", access.workspaceId)
    .eq("status", "pending");

  if (deliveryStateError) {
    console.error("Could not persist team invitation delivery state", {
      invitationId: reservation.invitationId,
      error: deliveryStateError.message,
    });
  }

  if (deliveryError) {
    if (reservation.outcome === "reserved") {
      const { error: cancellationError } = await service.rpc("cancel_workspace_invitation", {
        p_workspace_id: access.workspaceId,
        p_invitation_id: reservation.invitationId,
        p_actor_profile_id: access.userId,
        p_reason: "supabase_invite_delivery_failed",
      });
      if (cancellationError) {
        console.error("Could not release failed team invitation reservation", {
          invitationId: reservation.invitationId,
          error: cancellationError.message,
        });
      }
    }

    return NextResponse.json({ error: "Couldn't send that invitation." }, { status: 502 });
  }

  await recordAuditLog(service, {
    workspaceId: access.workspaceId,
    actorProfileId: access.userId,
    action: "team.invitation_sent",
    targetType: "workspace_invitation",
    targetId: reservation.invitationId,
    metadata: {
      recipientType: existingUser ? "existing_user" : "new_user",
      resend: reservation.outcome === "already_pending",
    },
  });

  return NextResponse.json({
    ok: true,
    invitationId: reservation.invitationId,
    message: `An invitation email has been sent to ${email}. Membership begins only after email verification.`,
  });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as CancelBody;
  if (!body.invitationId) {
    return NextResponse.json({ error: "Invitation ID is required." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);
  if (!guard.ok) return guard.response;
  const { access } = guard;

  if ((!access.isOperator && access.role !== "owner") || !canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Only the workspace owner can cancel invitations." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("cancel_workspace_invitation", {
    p_workspace_id: access.workspaceId,
    p_invitation_id: body.invitationId,
    p_actor_profile_id: access.userId,
    p_reason: "cancelled_by_owner",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcome = typeof data === "string" ? data : null;
  if (outcome === "owner_required") {
    return NextResponse.json({ error: "Only the workspace owner can cancel invitations." }, { status: 403 });
  }
  if (outcome === "workspace_not_found" || outcome === "invitation_not_found") {
    return NextResponse.json({ error: "Invitation was not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    outcome,
    message: outcome === "expired" ? "Invitation expired and its seat was released." : "Invitation cancelled.",
  });
}

async function findUserByEmail(service: ServiceClient, email: string): Promise<User | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data) {
      throw new Error(`Could not check the invited account: ${error?.message ?? "Unknown auth error"}`);
    }
    const match = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
    if (match) {
      return match;
    }
    if (data.users.length < 100) {
      return null;
    }
    page += 1;
  }
}

function invitationRedirect(request: NextRequest): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const url = new URL("/auth/confirm", configuredOrigin || request.nextUrl.origin);
  url.searchParams.set("next", "/settings#team");
  return url.toString();
}

function firstReservation(value: unknown): Reservation | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const outcome = (row as { outcome?: unknown }).outcome;
  const invitationId = (row as { invitation_id?: unknown }).invitation_id;
  if (typeof outcome !== "string") return null;
  return {
    outcome: outcome as ReservationOutcome,
    invitationId: typeof invitationId === "string" ? invitationId : null,
  };
}

function reservationRejection(outcome: ReservationOutcome): { status: number; message: string } | null {
  switch (outcome) {
    case "seat_limit_reached":
      return { status: 409, message: "All five named seats are in use or reserved. Cancel an invitation or remove a member first." };
    case "paid_plan_required":
      return { status: 403, message: "Team invitations unlock when Blockwise LeadGen is active." };
    case "owner_required":
      return { status: 403, message: "Only the workspace owner can invite members." };
    case "invalid_email":
      return { status: 400, message: "Enter a valid email address." };
    case "invalid_role":
      return { status: 400, message: "Choose a valid role." };
    case "invalid_member":
      return { status: 400, message: "That account cannot use a named workspace seat." };
    case "workspace_not_found":
      return { status: 404, message: "Workspace was not found." };
    default:
      return null;
  }
}
