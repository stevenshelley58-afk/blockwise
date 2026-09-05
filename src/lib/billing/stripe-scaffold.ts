import { createHmac, timingSafeEqual } from "node:crypto";

import {
  currencyForMarket,
  getBillingOffer,
  type BillingCurrency,
  type BillingMarket,
  type BillingOffer,
  type BillingProduct,
} from "./offers.ts";

const STRIPE_API_BASE = "https://api.stripe.com";
const WEBHOOK_TOLERANCE_SECONDS = 300;
const STRIPE_REQUEST_TIMEOUT_MS = 30000;

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
export type StripeFormParams = Record<string, string | number | boolean | null | undefined>;

export type StripeWebhookEvent = {
  id: string;
  type: string;
  created?: number;
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

export type CheckoutSessionInput = {
  workspaceId: string;
  market: BillingMarket;
  currency: BillingCurrency;
  product: BillingProduct;
  stripeCustomerId?: string | null;
  customerEmail: string | null;
  userId?: string | null;
  successUrl: string;
  cancelUrl: string;
  acceptedAt?: string;
  idempotencyKey?: string | null;
};

export type CheckoutSessionRequest = {
  offer: BillingOffer;
  params: StripeFormParams;
  idempotencyKey: string;
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

export function buildCheckoutSessionRequest(
  input: CheckoutSessionInput,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutSessionRequest {
  const offer = getBillingOffer(input.market, input.product);
  if (input.currency !== currencyForMarket(input.market) || input.currency !== offer.currency) {
    throw new Error(`Billing currency ${input.currency} does not match market ${input.market}.`);
  }

  const priceId = env[offer.priceEnvKey]?.trim();
  if (!priceId) {
    throw new BillingNotConfiguredError(`${offer.priceEnvKey} is not configured.`);
  }
  const couponId = offer.couponEnvKey ? env[offer.couponEnvKey]?.trim() : null;
  if (offer.product === "self_serve" && !couponId) {
    throw new BillingNotConfiguredError(`${offer.couponEnvKey} is not configured.`);
  }

  const customerEmail = input.customerEmail?.trim() || null;
  const userId = input.userId?.trim() || null;
  const stripeCustomerId = input.stripeCustomerId?.trim() || null;
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  const acceptanceMetadata: StripeFormParams = {
    "metadata[workspace_id]": input.workspaceId,
    "metadata[offer_key]": offer.key,
    "metadata[offer_version]": offer.version,
    "metadata[accepted_at]": acceptedAt,
    "metadata[market]": offer.market,
    "metadata[currency]": offer.currency,
    "metadata[first_invoice_amount]": offer.firstInvoiceAmount,
    "metadata[renewal_amount]": offer.recurringAmount,
    "metadata[triggering_rule]": offer.triggeringRule,
  };
  const subscriptionMetadata: StripeFormParams = Object.fromEntries(
    Object.entries(acceptanceMetadata).map(([key, value]) => [
      key.replace(/^metadata/, "subscription_data[metadata]"),
      value,
    ]),
  );
  const params: StripeFormParams = {
    mode: "subscription",
    "payment_method_types[0]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspaceId,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    ...(!stripeCustomerId && customerEmail ? { customer_email: customerEmail } : {}),
    ...(userId ? { "metadata[user_id]": userId } : {}),
    ...(userId ? { "subscription_data[metadata][user_id]": userId } : {}),
    ...acceptanceMetadata,
    ...subscriptionMetadata,
    "automatic_tax[enabled]": true,
    billing_address_collection: "required",
    "tax_id_collection[enabled]": true,
    "consent_collection[terms_of_service]": "required",
    "managed_payments[enabled]": false,
    "custom_text[submit][message]": offer.checkoutDisclosure,
    payment_method_collection: "always",
    ...(stripeCustomerId
      ? {
          "customer_update[address]": "auto",
          "customer_update[name]": "auto",
        }
      : {}),
    ...(offer.product === "self_serve"
      ? {
          "discounts[0][coupon]": couponId,
          "subscription_data[trial_period_days]": offer.trialDays,
          "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
        }
      : {}),
  };
  const idempotencyKey =
    input.idempotencyKey?.trim() || `checkout:${input.workspaceId}:${offer.key}:${offer.version}`;

  return { offer, params, idempotencyKey };
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<BillingSessionResult> {
  const request = buildCheckoutSessionRequest(input);
  const session = await stripePost<CheckoutSessionResponse>(
    "/v1/checkout/sessions",
    request.params,
    request.idempotencyKey,
  );
  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return { url: session.url };
}

export async function retrieveStripeSubscription(subscriptionId: string): Promise<StripeObject> {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
    throw new Error("Invalid Stripe subscription ID.");
  }

  return stripeGet<StripeObject>(`/v1/subscriptions/${subscriptionId}?expand[]=latest_invoice`);
}

export async function retrieveStripeCharge(chargeId: string): Promise<StripeObject> {
  if (!/^ch_[A-Za-z0-9]+$/.test(chargeId)) {
    throw new Error("Invalid Stripe charge ID.");
  }

  return stripeGet<StripeObject>(`/v1/charges/${chargeId}`);
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

async function stripePost<T>(path: string, params: StripeFormParams, idempotencyKey?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${getStripeSecretKey(true)}:`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: encodeStripeForm(params),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  const payload = (await response.json().catch(() => ({}))) as T & StripeErrorResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed with ${response.status}.`);
  }

  return payload as T;
}

async function stripeGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_BASE}${path}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${getStripeSecretKey(true)}:`).toString("base64")}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  const payload = (await response.json().catch(() => ({}))) as T & StripeErrorResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Stripe request failed with ${response.status}.`);
  }

  return payload as T;
}

function encodeStripeForm(params: StripeFormParams) {
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
