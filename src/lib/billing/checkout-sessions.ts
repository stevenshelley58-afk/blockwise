import type { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CheckoutSessionRecord = {
  sessionId: string;
  url: string;
  expiresAt: Date;
};

type SessionRow = {
  stripe_checkout_session_id: string;
  url: string;
  expires_at: string;
};

/** Reuse margin so a customer never clicks a session that expires mid-flow. */
const REUSE_MARGIN_MS = 5 * 60 * 1000;

/**
 * The eligible open Checkout session for this workspace and offer, if any.
 * Only unexpired rows are reusable; expired sessions stay in the table for
 * audit and are safely replaced by a fresh session.
 */
export async function findReusableCheckoutSession(
  service: ServiceClient,
  workspaceId: string,
  offerKey: string,
  now: Date = new Date(),
): Promise<CheckoutSessionRecord | null> {
  const { data, error } = await service
    .from("billing_checkout_sessions")
    .select("stripe_checkout_session_id, url, expires_at")
    .eq("workspace_id", workspaceId)
    .eq("offer_key", offerKey)
    .eq("status", "open")
    .gt("expires_at", new Date(now.getTime() + REUSE_MARGIN_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`Checkout session lookup failed: ${error.message}`);
  const row = (data ?? []).find(Boolean) as SessionRow | undefined;
  if (!row) return null;
  return {
    sessionId: row.stripe_checkout_session_id,
    url: row.url,
    expiresAt: new Date(row.expires_at),
  };
}

export async function recordCheckoutSession(
  service: ServiceClient,
  input: { workspaceId: string; offerKey: string; session: CheckoutSessionRecord },
): Promise<void> {
  const { error } = await service.from("billing_checkout_sessions").upsert(
    {
      workspace_id: input.workspaceId,
      stripe_checkout_session_id: input.session.sessionId,
      offer_key: input.offerKey,
      status: "open",
      url: input.session.url,
      expires_at: input.session.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_checkout_session_id" },
  );
  if (error) throw new Error(`Checkout session record failed: ${error.message}`);
}

export async function markCheckoutSession(
  service: ServiceClient,
  sessionId: string,
  status: "completed" | "expired",
): Promise<void> {
  const { error } = await service
    .from("billing_checkout_sessions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "open");
  if (error) throw new Error(`Checkout session ${status} update failed: ${error.message}`);
}

/** Best-effort wrappers: session bookkeeping must never break the main flow. */
export async function markCheckoutSessionBestEffort(
  service: ServiceClient,
  sessionId: string,
  status: "completed" | "expired",
): Promise<void> {
  try {
    await markCheckoutSession(service, sessionId, status);
  } catch (error) {
    console.error(`[billing] failed to mark checkout session ${status}`, { sessionId, error });
  }
}
