import type { ContentSkillName } from "./contracts.ts";

type ContentQueueClient = {
  schema(schema: string): {
    from(table: string): any;
  };
};

export type QueuedContentRun = {
  id: string | null;
  status: string;
};

export async function queueContentRun(input: {
  supabase: ContentQueueClient;
  workspaceId: string;
  runId: string;
  fromStep?: ContentSkillName;
}): Promise<QueuedContentRun> {
  const research = input.supabase.schema("research");
  const dedupeKey = `content-run:${input.workspaceId}:${input.runId}`;
  const payload = {
    contentRunId: input.runId,
    workspaceId: input.workspaceId,
    fromStep: input.fromStep ?? null,
  };

  const { data: existing, error: selectError } = await research
    .from("work_queue")
    .select("id,status")
    .eq("queue_name", "research")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["pending", "claimed", "failed", "blocked"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (selectError) throw selectError;

  const active = Array.isArray(existing) ? existing[0] : null;
  if (active?.status === "pending" || active?.status === "claimed") {
    return { id: active.id ?? null, status: active.status };
  }

  if (active?.id) {
    const { data, error } = await research
      .from("work_queue")
      .update({
        job_type: "blockwise-content-run-orchestrator",
        priority: 15,
        payload,
        status: "pending",
        available_at: new Date().toISOString(),
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        attempts: 0,
        max_attempts: 1,
        last_error: null,
        blocked_reason: null,
        result: {},
        completed_at: null,
      })
      .eq("id", active.id)
      .select("id,status")
      .single();

    if (error) throw error;
    return { id: data?.id ?? null, status: data?.status ?? "pending" };
  }

  const { data, error } = await research
    .from("work_queue")
    .insert({
      queue_name: "research",
      job_type: "blockwise-content-run-orchestrator",
      dedupe_key: dedupeKey,
      priority: 15,
      payload,
      status: "pending",
      max_attempts: 1,
    })
    .select("id,status")
    .single();

  if (error) throw error;
  return { id: data?.id ?? null, status: data?.status ?? "pending" };
}
