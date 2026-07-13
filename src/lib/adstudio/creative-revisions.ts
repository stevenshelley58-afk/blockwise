type RevisionRpcError = {
  code?: string;
  message?: string;
};

type RevisionRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RevisionRpcError | null }>;
};

type AppendCreativeRevisionInput = {
  workspaceId: string;
  creativeId: string;
  expectedActiveRevisionId: string;
  canvas: unknown;
  renderStatus: string;
  creationOperation: "targeted_edit";
  mutationId: string;
  requestHash: string;
};

type ClaimCreativeRevisionInput = Pick<
  AppendCreativeRevisionInput,
  "workspaceId" | "creativeId" | "expectedActiveRevisionId" | "mutationId" | "requestHash"
>;

export type AppendCreativeRevisionResult =
  | { ok: true; revisionId: string; revisionNumber: number }
  | { ok: false; reason: "stale_revision" };

export type ClaimCreativeRevisionResult =
  | { ok: true; state: "claimed" }
  | { ok: true; state: "completed"; revisionId: string; revisionNumber: number; canvas: unknown }
  | { ok: false; reason: "stale_revision" | "edit_in_progress" | "mutation_content_mismatch" };

export type ExecuteCreativeRevisionMutationResult<T> =
  | Exclude<ClaimCreativeRevisionResult, { ok: true; state: "claimed" }>
  | { ok: true; state: "executed"; value: T }
  | { ok: true; state: "work_failed"; error: unknown };

export async function claimAdStudioCreativeRevisionMutation(
  supabase: RevisionRpcClient,
  input: ClaimCreativeRevisionInput,
): Promise<ClaimCreativeRevisionResult> {
  const { data, error } = await supabase.rpc("adstudio_claim_creative_revision_mutation", {
    p_workspace_id: input.workspaceId,
    p_creative_id: input.creativeId,
    p_expected_active_revision_id: input.expectedActiveRevisionId,
    p_mutation_id: input.mutationId,
    p_request_hash: input.requestHash,
  });

  if (error) {
    if (error.code === "40001" || error.message?.includes("ADSTUDIO_STALE_REVISION")) {
      return { ok: false, reason: "stale_revision" };
    }
    if (error.code === "55P03" || error.message?.includes("ADSTUDIO_EDIT_IN_PROGRESS")) {
      return { ok: false, reason: "edit_in_progress" };
    }
    if (error.message?.includes("ADSTUDIO_MUTATION_CONTENT_MISMATCH")) {
      return { ok: false, reason: "mutation_content_mismatch" };
    }
    throw new Error(error.message || "Creative edit could not be claimed.");
  }

  const row = firstRow(data);
  if (!row || (row.state !== "claimed" && row.state !== "completed")) {
    throw new Error("Creative revision claim RPC returned an invalid result.");
  }
  if (row.state === "claimed") return { ok: true, state: "claimed" };
  if (typeof row.revision_id !== "string" || !Number.isInteger(row.revision_number)) {
    throw new Error("Completed creative revision claim is missing its revision.");
  }
  return {
    ok: true,
    state: "completed",
    revisionId: row.revision_id,
    revisionNumber: Number(row.revision_number),
    canvas: row.canvas_json,
  };
}

export async function executeAdStudioCreativeRevisionMutation<T>(
  supabase: RevisionRpcClient,
  input: ClaimCreativeRevisionInput,
  work: () => Promise<T>,
): Promise<ExecuteCreativeRevisionMutationResult<T>> {
  const claim = await claimAdStudioCreativeRevisionMutation(supabase, input);
  if (!claim.ok || claim.state === "completed") return claim;

  try {
    return { ok: true, state: "executed", value: await work() };
  } catch (error) {
    return { ok: true, state: "work_failed", error };
  }
}

export async function releaseAdStudioCreativeRevisionMutation(
  supabase: RevisionRpcClient,
  input: Pick<ClaimCreativeRevisionInput, "workspaceId" | "creativeId" | "mutationId">,
): Promise<void> {
  const { error } = await supabase.rpc("adstudio_release_creative_revision_mutation", {
    p_workspace_id: input.workspaceId,
    p_creative_id: input.creativeId,
    p_mutation_id: input.mutationId,
  });
  if (error) throw new Error(error.message || "Creative edit claim could not be released.");
}

export async function appendAdStudioCreativeRevision(
  supabase: RevisionRpcClient,
  input: AppendCreativeRevisionInput,
): Promise<AppendCreativeRevisionResult> {
  const { data, error } = await supabase.rpc("adstudio_append_creative_revision", {
    p_workspace_id: input.workspaceId,
    p_creative_id: input.creativeId,
    p_expected_active_revision_id: input.expectedActiveRevisionId,
    p_canvas_json: input.canvas,
    p_render_status: input.renderStatus,
    p_creation_operation: input.creationOperation,
    p_mutation_id: input.mutationId,
    p_request_hash: input.requestHash,
  });

  if (error) {
    if (error.code === "40001" || error.message?.includes("ADSTUDIO_STALE_REVISION")) {
      return { ok: false, reason: "stale_revision" };
    }
    throw new Error(error.message || "Creative revision could not be saved.");
  }

  const row = firstRow(data);
  if (!isRevisionRow(row)) {
    throw new Error("Creative revision RPC returned an invalid result.");
  }

  return {
    ok: true,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
  };
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function isRevisionRow(value: unknown): value is { revision_id: string; revision_number: number } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.revision_id === "string" && Number.isInteger(row.revision_number);
}
