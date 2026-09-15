import { createSupabaseServiceClient } from "../supabase/service.ts";
import { setStage } from "../mautic/flows.ts";

type BootstrapRpcClient = Pick<ReturnType<typeof createSupabaseServiceClient>, "rpc" | "from">;

type VerifiedAuthUser = {
  id: string;
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
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
  stageSetter?: typeof setStage;
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

  const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : null;
  if (workspaceId && (row.created === true || row.resumed === true)) {
    const { data: workspace, error: markerError } = await service
      .from("workspaces")
      .select("mautic_signed_up_queued_at")
      .eq("id", workspaceId)
      .maybeSingle();
    if (markerError) throw new Error(`Signed-up stage marker lookup failed: ${markerError.message}`);

    if (
      workspace
      && (workspace as { mautic_signed_up_queued_at?: string | null }).mautic_signed_up_queued_at == null
    ) {
      await (input.stageSetter ?? setStage)({
        email: input.user.email,
        firstName: firstName(input.user.user_metadata?.full_name),
        workspaceId,
        subjectId: workspaceId,
        stage: "signed_up",
      });

      const { error: updateError } = await service
        .from("workspaces")
        .update({ mautic_signed_up_queued_at: new Date().toISOString() })
        .eq("id", workspaceId)
        .is("mautic_signed_up_queued_at", null);
      if (updateError) throw new Error(`Signed-up stage marker update failed: ${updateError.message}`);
    }
  }

  return {
    workspaceId,
    created: row.created === true,
    resumed: row.resumed === true,
    eligible: row.eligible === true,
    trialEndsAt: typeof row.trial_ends_at === "string" ? row.trial_ends_at : null,
  };
}

function firstName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().split(/\s+/, 1)[0] || undefined;
}
