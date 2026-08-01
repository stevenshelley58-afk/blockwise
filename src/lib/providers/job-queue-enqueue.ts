import { createSupabaseServiceClient } from "../supabase/service.ts";

/**
 * Reversible producer-cutover switch for the Trigger.dev → VPS job_queue
 * migration.
 *
 * `BLOCKWISE_QUEUED_KINDS` is a comma-separated list of job kinds whose
 * producers should route to the Supabase `job_queue` (consumed by the VPS
 * worker) instead of Trigger.dev. Adding a kind flips its traffic to the
 * worker; removing it falls back to Trigger. Both paths are safe to coexist:
 * the worker only processes rows it claims from `job_queue`, and Trigger never
 * sees those rows, so there is no double-processing window.
 *
 * Producers run on Vercel API routes, which already hold the service-role key
 * needed to call `enqueue_job` (the queue RPCs are service-role only, mirroring
 * the provider_token_vault posture). Enqueuing is just a row insert — the
 * actual provider work still happens on the VPS worker, keeping Vercel free of
 * long-running provider calls.
 */
export function isQueuedKind(kind: string): boolean {
  const list = process.env.BLOCKWISE_QUEUED_KINDS ?? "";
  return list
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .includes(kind);
}

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
