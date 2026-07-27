import { createSupabaseServiceClient } from "../supabase/service.ts";

type BootstrapRpcClient = Pick<ReturnType<typeof createSupabaseServiceClient>, "rpc">;

type VerifiedAuthUser = {
  id: string;
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
};

type BootstrapRpcRow = {
  workspace_id?: string | null;
  created?: boolean | null;
  resumed?: boolean | null;
  eligible?: boolean | null;
  trial_ends_at?: string | null;
};

export type VerifiedWorkspaceBootstrapResult = {
  workspaceId: string | null;
  created: boolean;
  resumed: boolean;
  eligible: boolean;
  trialEndsAt: string | null;
};

export async function bootstrapVerifiedTrialWorkspace(input: {
  user: VerifiedAuthUser;
  serviceSupabase?: BootstrapRpcClient;
}): Promise<VerifiedWorkspaceBootstrapResult> {
  if (!input.user.id || !input.user.email || !(input.user.email_confirmed_at || input.user.confirmed_at)) {
    throw new Error("Email verification is required before workspace bootstrap.");
  }

  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("bootstrap_verified_trial_workspace", {
    p_verified_user_id: input.user.id,
  });
  if (error) {
    throw new Error(`Verified workspace bootstrap failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as BootstrapRpcRow | null;
  if (!row || typeof row !== "object") {
    throw new Error("Verified workspace bootstrap returned no result.");
  }

  return {
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
    created: row.created === true,
    resumed: row.resumed === true,
    eligible: row.eligible === true,
    trialEndsAt: typeof row.trial_ends_at === "string" ? row.trial_ends_at : null,
  };
}
