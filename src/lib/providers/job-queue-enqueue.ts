import { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceSupabase = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Enqueue provider/background work for the VPS worker. Producers on Vercel do
 * only the workspace-fenced service-role RPC; the durable queue owns retries
 * and leases, and provider execution stays on the VPS.
 */

export async function enqueueQueuedJob(input: {
  workspaceId: string;
  kind: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  dedupeKey?: string | null;
  runAfter?: Date;
}): Promise<{ id: string | null }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("enqueue_job_v2", {
    p_workspace_id: input.workspaceId,
    p_kind: input.kind,
    p_payload: input.payload,
    p_max_attempts: input.maxAttempts ?? 3,
    p_run_after: (input.runAfter ?? new Date()).toISOString(),
    p_dedupe_key: input.dedupeKey ?? null,
  });

  if (error) {
    throw new Error(`enqueue_job_v2 failed: ${error.message}`);
  }

  return { id: typeof data === "string" ? data : null };
}

/**
 * Cancel a recovery job only while it is still pending. Once a worker has
 * claimed the row, its lease owns settlement and this function returns false.
 */
export async function cancelQueuedJob(input: {
  serviceSupabase?: ServiceSupabase;
  workspaceId: string;
  jobId: string;
}): Promise<boolean> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("cancel_job_v2", {
    p_workspace_id: input.workspaceId,
    p_id: input.jobId,
  });

  if (error) {
    throw new Error(`cancel_job_v2 failed: ${error.message}`);
  }

  return data === true;
}
