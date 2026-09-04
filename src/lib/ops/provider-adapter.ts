import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueEmail, type OutboxEnqueueInput, type OutboxEnqueueResult } from "../email/outbox.ts";
import { assertMarketingSendAllowed, type MarketingSendDecision } from "./marketing-send-guard.ts";
import { buildProjectionEnvelope, mapProjectionForAdapter, type AdapterMapping, type BlockwiseProjectionEnvelope } from "./projection-contract.ts";

/** Adapter boundary for Hermes. It returns a mapping; it never performs I/O. */
export function toProviderAdapterMapping(envelope: BlockwiseProjectionEnvelope): AdapterMapping {
  return mapProjectionForAdapter(envelope);
}

/** The only marketing sender entrypoint: consent and suppression are checked
 * immediately before the caller enqueues mail. Transactional messages must not
 * call this function and must use their separate delivery policy. */
export async function assertMarketingSendAtAdapterBoundary(input: {
  workspaceId: string;
  email: string;
  topic: string;
  serviceSupabase: SupabaseClient;
}): Promise<MarketingSendDecision> {
  return assertMarketingSendAllowed(input);
}

/**
 * Marketing sender adapter entrypoint. The guard is part of this function,
 * rather than a convention at individual call sites, so a future provider
 * worker cannot accidentally enqueue a campaign without current consent.
 */
export async function enqueueMarketingMessage(input: {
  workspaceId: string;
  email: string;
  topic: string;
  serviceSupabase: SupabaseClient;
  message: OutboxEnqueueInput;
}): Promise<OutboxEnqueueResult> {
  if (input.message.to.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
    throw new Error("marketing_send_recipient_mismatch");
  }
  const decision = await assertMarketingSendAtAdapterBoundary(input);
  if (!decision.allowed) throw new Error(`marketing_send_denied:${decision.reason}`);
  return enqueueEmail(input.serviceSupabase, input.message);
}

export { buildProjectionEnvelope };
