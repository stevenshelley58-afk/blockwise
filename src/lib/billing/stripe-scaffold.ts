import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export class BillingNotConfiguredError extends Error {
  constructor(message = "Billing is not connected yet.") {
    super(message);
    this.name = "BillingNotConfiguredError";
  }
}

export class StripeWebhookVerificationError extends Error {
  constructor(message = "Invalid Stripe webhook signature.") {
    super(message);
    this.name = "StripeWebhookVerificationError";
  }
}

export function isBillingConfigured(): boolean {
  return Boolean(getStripeSecretKey(false));
}

export type BillingSessionResult = { url: string };

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: {
    object: StripeObject;
  };
};

export type StripeObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, string | null | undefined> | null;
};

type CheckoutSessionResponse = {
  id: string;
  url?: string | null;
};

type PortalSessionResponse = {
  id: string;
  url?: string | null;
};

type StripeErrorResponse = {
  error?: {
    message?: string;
    type?: string;
  };
};

export function resolveStripePriceId(planKey?: string | null): string {
  const mappedPriceId = resolveMappedPriceId(planKey);
  const fallbackPriceId = process.env.STRIPE_PRICE_ID?.trim();
  const priceId = mappedPriceId || fallbackPriceId;

  if (!priceId) {
    throw new BillingNotConfiguredError("Stripe subscription price is not configured.");
  }

  return priceId;
}

export async function createBillingPortalSession(input: {
  workspaceId: string;
  stripeCustomerId: string | null;
  returnUrl: string;
}): Promise<BillingSessionResult> {
  if (!input.stripeCustomerId) {
    throw new BillingNotConfiguredError("Stripe customer is not connected yet.");
  }

  const session = await stripePost<PortalSessionResponse>("/v1/billing_portal/sessions", {
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a billing portal URL.");
  }

  return { url: session.url };
}

export async function createCheckoutSession(input: {
  workspaceId: string;
  priceId?: string | null;
  stripeCustomerId?: string | null;
  customerEmail: string | null;
  userId?: string | null;
  planKey?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<BillingSessionResult> {
  const priceId = input.priceId?.trim() || resolveStripePriceId(input.planKey);
  const customerEmail = input.customerEmail?.trim() || null;
  const userId = input.userId?.trim() || null;
  const stripeCustomerId = input.stripeCustomerId?.trim() || null;

  const session = await stripePost<CheckoutSessionResponse>("/v1/checkout/sessions", {
    mode: "subscription",
    "payment_method_types[0]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspaceId,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    ...(!stripeCustomerId && customerEmail ? { customer_email: customerEmail } : {}),
    "metadata[workspace_id]": input.workspaceId,
    ...(userId ? { "metadata[user_id]": userId } : {}),
    ...(input.planKey ? { "metadata[plan_key]": input.planKey } : {}),
    "subscription_data[metadata][workspace_id]": input.workspaceId,
    ...(userId ? { "subscription_data[metadata][user_id]": userId } : {}),
    ...(input.planKey ? { "subscription_data[metadata][plan_key]": input.planKey } : {}),
    allow_promotion_codes: process.env.STRIPE_ALLOW_PROMOTION_CODES === "true",
    billing_address_collection: "auto",
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { url: session.url };
}

export function constructStripeWebhookEvent(
  payload: string,
  signatureHeader: string | null,
  secret = process.env.STRIPE_WEBHOOK_SECRET,
): StripeWebhookEvent {
  const webhookSecret = secret?.trim();

  if (!webhookSecret) {
    throw new BillingNotConfiguredError("Stripe webhook secret is not configured.");
  }
  if (!signatureHeader) {
    throw new StripeWebhookVerificationError("Stripe-Signature header is missing.");
  }

  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);

  if (!timestamp || ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new StripeWebhookVerificationError("Stripe webhook timestamp is outside the allowed tolerance.");
  }
  if (signatures.length === 0) {
    throw new StripeWebhookVerificationError("Stripe webhook v1 signature is missing.");
  }

  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const verified = signatures.some((signature) => safeEqualHex(signature, expected));

  if (!verified) {
    throw new StripeWebhookVerificationError();
  }

  let event: Partial<StripeWebhookEvent>;
  try {
    event = JSON.parse(payload) as Partial<StripeWebhookEvent>;
  } catch {
    throw new StripeWebhookVerificationError("Stripe webhook payload is not valid JSON.");
  }

  if (!event.id || !event.type || !event.data?.object) {
    throw new StripeWebhookVerificationError("Stripe webhook payload is not a valid event.");
  }

  return event as StripeWebhookEvent;
}

async function stripePost<T>(path: string, params: Record<string, string | number | boolean | null | undefined>): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${getStripeSecretKey(true)}:`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: encodeStripeForm(params),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & StripeErrorResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed with ${response.status}.`);
  }

  return payload as T;
}

function encodeStripeForm(params: Record<string, string | number | boolean | null | undefined>) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    body.append(key, String(value));
  }

  return body;
}

function getStripeSecretKey(required: true): string;
function getStripeSecretKey(required?: false): string | null;
function getStripeSecretKey(required = false): string | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() || null;

  if (!secretKey && required) {
    throw new BillingNotConfiguredError();
  }

  return secretKey;
}

function resolveMappedPriceId(planKey?: string | null): string | null {
  const key = planKey?.trim();
  const mapping = process.env.STRIPE_PRICE_IDS_JSON?.trim();

  if (!key || !mapping) {
    return null;
  }

  try {
    const parsed = JSON.parse(mapping) as Record<string, unknown>;
    const value = parsed[key];

    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    throw new BillingNotConfiguredError("STRIPE_PRICE_IDS_JSON is not valid JSON.");
  }
}

function parseStripeSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = 0;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);

    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}
