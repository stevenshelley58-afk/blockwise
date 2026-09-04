import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketingSendDecision = { allowed: boolean; reason: string };

/**
 * All marketing senders must call this service-role RPC immediately before
 * enqueueing a send. Unknown consent, missing topic consent, unsubscribe, and
 * suppression are explicit denies; transactional mail should use its own
 * policy and never bypass this marketing guard accidentally.
 */
export async function assertMarketingSendAllowed(input: {
  workspaceId: string;
  email: string;
  topic: string;
  serviceSupabase: SupabaseClient;
}): Promise<MarketingSendDecision> {
  const email = input.email.trim().toLowerCase();
  const topic = input.topic.trim().toLowerCase();
  if (!email || !topic) return { allowed: false, reason: "invalid_recipient_or_topic" };
  const { data, error } = await input.serviceSupabase.rpc("can_send_marketing", {
    p_workspace_id: input.workspaceId,
    p_email: email,
    p_topic: topic,
  });
  if (error) throw new Error(`Marketing send guard failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const decision = row && typeof row === "object" ? row as { allowed?: unknown; reason?: unknown } : {};
  return {
    allowed: decision.allowed === true,
    reason: typeof decision.reason === "string" ? decision.reason : "consent_not_granted",
  };
}
