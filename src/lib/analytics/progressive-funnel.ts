import type { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const PROGRESSIVE_FUNNEL_EVENT_NAMES = [
  "cta_clicked",
  "email_submitted",
  "email_verified",
  "website_submitted",
  "brand_pack_approved",
  "template_selected",
  "first_generation_started",
  "first_generation_completed",
  "third_free_ad_completed",
  "meta_prompt_shown",
  "meta_connected",
  "meta_help_requested",
  "checkout_started",
  "checkout_completed",
  "free_campaign_launched",
  "first_invoice_paid",
  "onboarding_booked",
  "onboarding_completed",
  "first_renewal_paid",
  "managed_inquiry",
  "managed_checkout",
  "cancellation",
  "payment_failed",
] as const;

export type ProgressiveFunnelEventName = (typeof PROGRESSIVE_FUNNEL_EVENT_NAMES)[number];
export type ProgressiveFunnelCountry = "US" | "AU";
export type ProgressiveFunnelDomain = "marketing" | "activation" | "meta" | "billing" | "booking";
export type ProgressiveFunnelProperty = string | number | boolean | null;

const EVENT_DOMAINS = {
  cta_clicked: "marketing",
  email_submitted: "activation",
  email_verified: "activation",
  website_submitted: "activation",
  brand_pack_approved: "activation",
  template_selected: "activation",
  first_generation_started: "activation",
  first_generation_completed: "activation",
  third_free_ad_completed: "activation",
  meta_prompt_shown: "meta",
  meta_connected: "meta",
  meta_help_requested: "meta",
  checkout_started: "billing",
  checkout_completed: "billing",
  free_campaign_launched: "meta",
  first_invoice_paid: "billing",
  onboarding_booked: "booking",
  onboarding_completed: "booking",
  first_renewal_paid: "billing",
  managed_inquiry: "marketing",
  managed_checkout: "billing",
  cancellation: "billing",
  payment_failed: "billing",
} as const satisfies Record<ProgressiveFunnelEventName, ProgressiveFunnelDomain>;

export type ProgressiveFunnelEventInput<Name extends ProgressiveFunnelEventName = ProgressiveFunnelEventName> = {
  eventName: Name;
  /**
   * Null is allowed only for the pre-workspace marketing/auth steps. Transaction
   * owners must attach the workspace as soon as one exists.
   */
  workspaceId: string | null;
  /** Confirmed workspace market when available; null before confirmation. */
  country: ProgressiveFunnelCountry | null;
  /** Stable first-touch source such as "direct", "meta", or a campaign slug. */
  acquisitionSource: string;
  /**
   * Opaque server-owned mutation or provider event key. Never use an email
   * address, access token, or other customer data.
   */
  idempotencyKey: string;
  occurredAt?: Date;
  properties?: Readonly<Record<string, ProgressiveFunnelProperty>>;
};

export type ActivationFunnelEventName = Extract<
  ProgressiveFunnelEventName,
  | "email_submitted"
  | "email_verified"
  | "website_submitted"
  | "brand_pack_approved"
  | "template_selected"
  | "first_generation_started"
  | "first_generation_completed"
  | "third_free_ad_completed"
>;

export type MetaFunnelEventName = Extract<
  ProgressiveFunnelEventName,
  "meta_prompt_shown" | "meta_connected" | "meta_help_requested" | "free_campaign_launched"
>;

export type BillingFunnelEventName = Extract<
  ProgressiveFunnelEventName,
  | "checkout_started"
  | "checkout_completed"
  | "first_invoice_paid"
  | "first_renewal_paid"
  | "managed_checkout"
  | "cancellation"
  | "payment_failed"
>;

export type BookingFunnelEventName = Extract<
  ProgressiveFunnelEventName,
  "onboarding_booked" | "onboarding_completed"
>;

/**
 * Persists only server-confirmed funnel events. The supplied client must be the
 * service-role client; database RLS grants no anon or authenticated access.
 */
export async function recordProgressiveFunnelEvent<Name extends ProgressiveFunnelEventName>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
): Promise<void> {
  const row = {
    event_name: input.eventName,
    event_domain: EVENT_DOMAINS[input.eventName],
    workspace_id: normalizeWorkspaceId(input.workspaceId),
    country_code: input.country,
    acquisition_source: requiredText(input.acquisitionSource, "Acquisition source", 128),
    idempotency_key: opaqueIdempotencyKey(input.idempotencyKey),
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    properties: normalizeProperties(input.properties),
  };

  const { error } = await service
    .from("progressive_funnel_events")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) {
    throw new Error(`Progressive funnel event could not be recorded: ${error.message}`);
  }
}

/**
 * Analytics must never roll back or change the response of the owning domain
 * transaction. Call this only after the authoritative mutation succeeds.
 */
export async function recordProgressiveFunnelEventBestEffort<
  Name extends ProgressiveFunnelEventName,
>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
): Promise<boolean> {
  try {
    await recordProgressiveFunnelEvent(service, input);
    return true;
  } catch (error) {
    console.error("[progressive-funnel] event write failed", {
      eventName: input.eventName,
      workspaceId: input.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function recordWorkspaceFunnelEventBestEffort<
  Name extends ProgressiveFunnelEventName,
>(
  service: ServiceClient,
  input: Omit<
    ProgressiveFunnelEventInput<Name>,
    "country" | "acquisitionSource"
  > & {
    acquisitionSource?: string;
  },
): Promise<boolean> {
  const country = await loadWorkspaceCountryBestEffort(service, input.workspaceId);
  return recordProgressiveFunnelEventBestEffort(service, {
    ...input,
    country,
    acquisitionSource: input.acquisitionSource?.trim() || "unattributed",
  });
}

export function recordActivationFunnelEvent<Name extends ActivationFunnelEventName>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
) {
  return recordProgressiveFunnelEvent(service, input);
}

export function recordMetaFunnelEvent<Name extends MetaFunnelEventName>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
) {
  return recordProgressiveFunnelEvent(service, input);
}

export function recordBillingFunnelEvent<Name extends BillingFunnelEventName>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
) {
  return recordProgressiveFunnelEvent(service, input);
}

export function recordBookingFunnelEvent<Name extends BookingFunnelEventName>(
  service: ServiceClient,
  input: ProgressiveFunnelEventInput<Name>,
) {
  return recordProgressiveFunnelEvent(service, input);
}

async function loadWorkspaceCountryBestEffort(
  service: ServiceClient,
  workspaceId: string | null,
): Promise<ProgressiveFunnelCountry | null> {
  if (!workspaceId) return null;
  try {
    const { data, error } = await service
      .from("workspaces")
      .select("country_code")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) return null;
    const country = (data as { country_code?: unknown } | null)?.country_code;
    return country === "US" || country === "AU" ? country : null;
  } catch {
    return null;
  }
}

function normalizeWorkspaceId(value: string | null): string | null {
  if (value === null) return null;
  return requiredText(value, "Workspace ID", 128);
}

function opaqueIdempotencyKey(value: string): string {
  const normalized = requiredText(value, "Idempotency key", 256);
  if (normalized.includes("@") || /\s/u.test(normalized)) {
    throw new Error("Idempotency key must be opaque and contain no email address or whitespace.");
  }
  return normalized;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function normalizeProperties(
  properties: ProgressiveFunnelEventInput["properties"],
): Record<string, ProgressiveFunnelProperty> {
  if (!properties) return {};
  const entries = Object.entries(properties);
  if (entries.length > 32) throw new Error("Progressive funnel event properties are limited to 32 fields.");

  return Object.fromEntries(
    entries.map(([rawKey, value]) => {
      const key = requiredText(rawKey, "Property name", 64);
      if (!/^[a-z][a-z0-9_]*$/u.test(key)) {
        throw new Error(`Invalid progressive funnel property name: ${key}`);
      }
      if (typeof value === "string" && value.length > 512) {
        throw new Error(`Progressive funnel property ${key} is too long.`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`Progressive funnel property ${key} must be finite.`);
      }
      return [key, value];
    }),
  );
}
