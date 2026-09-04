import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase/service.ts";

export type ProjectionProvider = "mautic" | "chatwoot";
export type ProjectionAggregate = "contact" | "lifecycle" | "enquiry" | "support";
const SAFE_PAYLOAD_KEYS = new Set(["workspaceId", "sourceEventId", "sourceVersion", "profileId", "leadId", "topic", "eventType"]);

/** Call after the source transaction has committed. No provider I/O happens here. */
export async function enqueueOperationsProjectionAfterCommit(input: {
  workspaceId: string;
  provider: ProjectionProvider;
  aggregateType: ProjectionAggregate;
  aggregateId: string;
  sourceEventId: string;
  sourceVersion: number;
  payload: Record<string, unknown>;
  serviceSupabase?: SupabaseClient;
}): Promise<{ id: string | null }> {
  if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1) {
    throw new Error("Projection sourceVersion must be a positive integer");
  }
  const client = input.serviceSupabase ?? createSupabaseServiceClient();
  const payload = Object.fromEntries(Object.entries(input.payload).filter(([key]) => SAFE_PAYLOAD_KEYS.has(key)));
  const { data, error } = await client.rpc("enqueue_ops_projection", {
    p_workspace_id: input.workspaceId,
    p_provider: input.provider,
    p_aggregate_type: input.aggregateType,
    p_aggregate_id: input.aggregateId,
    p_operation: "upsert",
    p_source_event_id: input.sourceEventId,
    p_source_version: input.sourceVersion,
    p_payload: { ...payload, workspaceId: input.workspaceId },
  });
  if (error) throw new Error(`enqueue_ops_projection failed: ${error.message}`);
  return { id: typeof data === "string" ? data : null };
}
