import { createSupabaseServiceClient } from "../supabase/service.ts";

/**
 * Enqueue provider/background work for the VPS worker. Producers on Vercel do
 * only the service-role RPC; the durable queue owns retries and leases.
 */

export async function enqueueQueuedJob(input: {
  kind: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  dedupeKey?: string | null;
  runAfter?: Date;
}): Promise<{ id: string | null }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("enqueue_job", {
    p_kind: input.kind,
    p_payload: input.payload,
    p_max_attempts: input.maxAttempts ?? 3,
    p_run_after: (input.runAfter ?? new Date()).toISOString(),
    p_dedupe_key: input.dedupeKey ?? null,
  });

  if (error) {
    throw new Error(`enqueue_job failed: ${error.message}`);
  }

  return { id: typeof data === "string" ? data : null };
}
