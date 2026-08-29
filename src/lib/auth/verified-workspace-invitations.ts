import { createSupabaseServiceClient } from "../supabase/service.ts";

type InvitationRpcClient = Pick<ReturnType<typeof createSupabaseServiceClient>, "rpc">;

type VerifiedAuthUser = {
  id: string;
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
};

export type VerifiedWorkspaceInvitationAcceptance = {
  invitationId: string;
  workspaceId: string;
  outcome: "accepted" | "already_member" | "expired" | "paid_plan_required";
};

type AcceptanceRow = {
  invitation_id?: unknown;
  workspace_id?: unknown;
  outcome?: unknown;
};

const ACCEPTANCE_OUTCOMES = new Set<VerifiedWorkspaceInvitationAcceptance["outcome"]>([
  "accepted",
  "already_member",
  "expired",
  "paid_plan_required",
]);

export async function acceptVerifiedWorkspaceInvitations(input: {
  user: VerifiedAuthUser;
  serviceSupabase?: InvitationRpcClient;
}): Promise<VerifiedWorkspaceInvitationAcceptance[]> {
  if (!input.user.id || !input.user.email || !(input.user.email_confirmed_at || input.user.confirmed_at)) {
    throw new Error("A verified email is required before accepting workspace invitations.");
  }

  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("accept_verified_workspace_invitations", {
    p_verified_user_id: input.user.id,
  });
  if (error) {
    throw new Error(`Verified workspace invitation acceptance failed: ${error.message}`);
  }

  return (Array.isArray(data) ? data : data ? [data] : []).flatMap((value) => {
    const row = value as AcceptanceRow;
    if (
      typeof row.invitation_id !== "string"
      || typeof row.workspace_id !== "string"
      || typeof row.outcome !== "string"
      || !ACCEPTANCE_OUTCOMES.has(row.outcome as VerifiedWorkspaceInvitationAcceptance["outcome"])
    ) {
      return [];
    }

    return [{
      invitationId: row.invitation_id,
      workspaceId: row.workspace_id,
      outcome: row.outcome as VerifiedWorkspaceInvitationAcceptance["outcome"],
    }];
  });
}
