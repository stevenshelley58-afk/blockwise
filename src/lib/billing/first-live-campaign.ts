import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { StripeObject } from "./stripe-scaffold.ts";

type BillingServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type WorkspaceBillingRow = {
  stripe_subscription_id: string | null;
};

export type FirstLiveCampaignBillingEligibility = {
  subscriptionId: string;
  subscription: StripeObject;
};

export type FirstLiveCampaignStripeGateway = {
  retrieveSubscription(subscriptionId: string): Promise<StripeObject>;
  endTrial(subscriptionId: string, idempotencyKey: string): Promise<StripeObject>;
};

export async function validateFirstLiveCampaignBilling(input: {
  service: BillingServiceClient;
  workspaceId: string;
  gateway?: FirstLiveCampaignStripeGateway;
  allowActive?: boolean;
}): Promise<FirstLiveCampaignBillingEligibility> {
  const { data, error } = await input.service
    .from("workspaces")
    .select("stripe_subscription_id")
    .eq("id", input.workspaceId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Workspace billing could not be loaded.");
  }

  const row = data as WorkspaceBillingRow;
  const subscriptionId = row.stripe_subscription_id?.trim();
  if (!subscriptionId) {
    throw new Error("Add and validate a payment method before publishing the first live campaign.");
  }

  const gateway = input.gateway ?? stripeGateway;
  const subscription = await gateway.retrieveSubscription(subscriptionId);
  const status = stringValue(subscription.status);
  if (status !== "trialing" && !(input.allowActive && status === "active")) {
    throw new Error("The Blockwise subscription must be trialing before the free live campaign is published.");
  }
  if (status === "trialing" && !hasReusablePaymentMethod(subscription)) {
    throw new Error("Add a reusable payment method before publishing the first live campaign.");
  }

  return { subscriptionId, subscription };
}

export async function endTrialAfterFirstLiveCampaign(input: {
  service: BillingServiceClient;
  workspaceId: string;
  subscriptionId: string;
  idempotencyKey: string;
  gateway?: FirstLiveCampaignStripeGateway;
}): Promise<StripeObject> {
  const gateway = input.gateway ?? stripeGateway;
  let subscription = await gateway.retrieveSubscription(input.subscriptionId);
  const currentStatus = stringValue(subscription.status);

  if (currentStatus === "trialing") {
    if (!hasReusablePaymentMethod(subscription)) {
      throw new Error("Stripe no longer reports a reusable payment method for this subscription.");
    }
    subscription = await gateway.endTrial(input.subscriptionId, requiredKey(input.idempotencyKey));
  } else if (currentStatus !== "active") {
    throw new Error(`Stripe subscription cannot end its trial from status ${currentStatus ?? "unknown"}.`);
  }

  return subscription;
}

export function hasReusablePaymentMethod(subscription: StripeObject): boolean {
  if (stripeId(subscription.default_payment_method, "pm_")) return true;
  const customer = objectValue(subscription.customer);
  const invoiceSettings = objectValue(customer?.invoice_settings);
  return Boolean(stripeId(invoiceSettings?.default_payment_method, "pm_"));
}

const stripeGateway: FirstLiveCampaignStripeGateway = {
  retrieveSubscription(subscriptionId) {
    validateStripeId(subscriptionId, "sub_");
    return stripeRequest(
      `/v1/subscriptions/${subscriptionId}?expand[]=default_payment_method&expand[]=customer.invoice_settings.default_payment_method`,
    );
  },
  endTrial(subscriptionId, idempotencyKey) {
    validateStripeId(subscriptionId, "sub_");
    return stripeRequest(`/v1/subscriptions/${subscriptionId}`, {
      method: "POST",
      body: new URLSearchParams({ trial_end: "now" }),
      idempotencyKey,
    });
  },
};

async function stripeRequest(
  path: string,
  options?: { method: "POST"; body: URLSearchParams; idempotencyKey: string },
): Promise<StripeObject> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe billing is not configured.");
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options?.method ?? "GET",
    headers: {
      authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      ...(options ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(options ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: options?.body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as StripeObject & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed with ${response.status}.`);
  }
  return payload;
}

function validateStripeId(value: string, prefix: string) {
  if (!new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(value)) {
    throw new Error(`Invalid Stripe ${prefix === "sub_" ? "subscription" : "object"} ID.`);
  }
}

function stripeId(value: unknown, prefix: string): string | null {
  const direct = stringValue(value);
  if (direct?.startsWith(prefix)) return direct;
  const object = objectValue(value);
  const id = stringValue(object?.id);
  return id?.startsWith(prefix) ? id : null;
}

function requiredKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Billing idempotency key is required.");
  return normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StripeObject) : null;
}
