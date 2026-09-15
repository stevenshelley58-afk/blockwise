import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { AD_STUDIO_CHECKOUT_TRIAL_VERSIONS } from "./offers.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * When this workspace first accepted a trial-bearing self-serve offer, if ever.
 *
 * Read from the accepted-terms records rather than a new column: every
 * completed Checkout already writes an acceptance row keyed by offer version,
 * so cohort membership is derivable from data the product already keeps and
 * cannot drift from what the customer actually agreed to.
 *
 * Returns null when the workspace has never accepted a trial offer. A read
 * failure returns null too: it must not block a legitimate first-time
 * customer, and the duplicate-subscription guards in checkout-policy still
 * prevent a second subscription.
 */
export async function findTrialConsumedAt(
  service: ServiceClient,
  workspaceId: string,
): Promise<string | null> {
  try {
    const { data, error } = await service
      .from("billing_offer_acceptances")
      .select("accepted_at")
      .eq("workspace_id", workspaceId)
      .in("offer_version", [...AD_STUDIO_CHECKOUT_TRIAL_VERSIONS])
      .order("accepted_at", { ascending: true })
      .limit(1);

    if (error) throw new Error(error.message);
    const first = (data ?? [])[0] as { accepted_at?: unknown } | undefined;
    const acceptedAt = first?.accepted_at;
    return typeof acceptedAt === "string" && acceptedAt.trim() ? acceptedAt.trim() : null;
  } catch (error) {
    console.error("[billing] trial cohort lookup failed", { workspaceId, error });
    return null;
  }
}
