/**
 * Offer versions. Bump the relevant constant whenever the customer-facing
 * commercial terms of an offer change, so accepted terms stay attributable to
 * the exact terms the customer saw.
 *
 * Offers version independently: the managed service is unchanged by the
 * self-serve trial offer, so it keeps its original version.
 */
export const BILLING_OFFER_VERSION = "2026-09-06";
export const AD_STUDIO_TRIAL_OFFER_VERSION = "2026-09-15";

export type BillingOfferVersion =
  | typeof BILLING_OFFER_VERSION
  | typeof AD_STUDIO_TRIAL_OFFER_VERSION;

// Blockwise launches in Australia only. US offers are intentionally absent;
// reintroducing a market means adding its offers back and widening
// isBillingMarket/currencyForMarket together with the signup and onboarding UI.
export type BillingMarket = "AU";
export type BillingCurrency = "AUD";
export type BillingProduct = "ad_studio" | "managed";
export type StripeTaxBehavior = "exclusive" | "inclusive";

/**
 * How the subscription trial begins, stated explicitly rather than inferred.
 *
 * - `stripe_checkout_trial`: Checkout collects a card and Stripe runs the full
 *   trial window from subscription activation. The trial clock is Stripe's
 *   `trial_start`/`trial_end`, never a first delivery or a first publish.
 * - `none`: no subscription trial; the first invoice is due at Checkout.
 *
 * Never derive this from "the offer version is not the current one". A version
 * comparison cannot express cohort membership and silently changes meaning
 * every time a version is bumped.
 */
export type BillingTrialStart = "stripe_checkout_trial" | "none";

export type BillingOffer = {
  key: `${BillingProduct}_${BillingMarket}`;
  version: BillingOfferVersion;
  market: BillingMarket;
  currency: BillingCurrency;
  product: BillingProduct;
  recurringAmount: number;
  /**
   * Subscription amount due at trial start. Zero for a card-collected trial;
   * the renewal amount stays `recurringAmount`.
   */
  firstInvoiceAmount: number;
  trialDays: number;
  trialStart: BillingTrialStart;
  taxBehavior: StripeTaxBehavior;
  priceEnvKey: string;
  triggeringRule: string;
  checkoutDisclosure: string;
  /**
   * Consent text when a customer is not trial-eligible and is charged at
   * Checkout instead. A returning customer must never see trial terms they
   * will not receive.
   */
  checkoutDisclosureNoTrial: string;
};

const AD_STUDIO_TRIGGER =
  "Publishing through Blockwise needs a card and starts a 7-day Blockwise trial. The trial covers the Blockwise subscription only. Creating, editing, saving and downloading an ad need no card and are not the trial. Meta ad spend is charged separately by Meta, including during the trial.";

const AD_STUDIO_DISCLOSURE =
  "Your card is saved today and is not charged until your 7-day free trial ends. After the trial, your Blockwise Ad studio subscription renews automatically at A$249 per month until you cancel. Cancel any time in Settings under billing. Prices include GST where Blockwise is required to collect it. Meta ad spend is separate and is charged by Meta, including during your trial.";

const AD_STUDIO_DISCLOSURE_NO_TRIAL =
  "Your Blockwise Ad studio subscription starts today at A$249 per month and renews automatically each month until you cancel. Cancel any time in Settings under billing. Prices include GST where Blockwise is required to collect it. Meta ad spend is separate and is charged by Meta.";

export const BILLING_OFFERS: Readonly<Record<`${BillingProduct}_${BillingMarket}`, BillingOffer>> = {
  ad_studio_AU: {
    key: "ad_studio_AU",
    version: AD_STUDIO_TRIAL_OFFER_VERSION,
    market: "AU",
    currency: "AUD",
    product: "ad_studio",
    recurringAmount: 24_900,
    firstInvoiceAmount: 0,
    trialDays: 7,
    trialStart: "stripe_checkout_trial",
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_AD_STUDIO_AUD_PRICE_ID",
    triggeringRule: AD_STUDIO_TRIGGER,
    checkoutDisclosure: AD_STUDIO_DISCLOSURE,
    checkoutDisclosureNoTrial: AD_STUDIO_DISCLOSURE_NO_TRIAL,
  },
  managed_AU: {
    key: "managed_AU",
    version: BILLING_OFFER_VERSION,
    market: "AU",
    currency: "AUD",
    product: "managed",
    recurringAmount: 150_000,
    firstInvoiceAmount: 150_000,
    trialDays: 0,
    trialStart: "none",
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_MANAGED_AUD_PRICE_ID",
    triggeringRule: "The managed starts when its first invoice is paid.",
    checkoutDisclosure:
      "Managed starts at A$1,500 monthly. Meta ad spend is separate. Additional brands, ad accounts, or campaign volume require a written scope change.",
    checkoutDisclosureNoTrial:
      "Managed starts at A$1,500 monthly. Meta ad spend is separate. Additional brands, ad accounts, or campaign volume require a written scope change.",
  },
};

export function isBillingMarket(value: unknown): value is BillingMarket {
  return value === "AU";
}

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === "AUD";
}

export function isBillingProduct(value: unknown): value is BillingProduct {
  return value === "ad_studio" || value === "managed";
}

export function currencyForMarket(_market: BillingMarket): BillingCurrency {
  return "AUD";
}

export function getBillingOffer(market: BillingMarket, product: BillingProduct): BillingOffer {
  return BILLING_OFFERS[`${product}_${market}`];
}

/**
 * The offer definition an accepted-terms record refers to, or null when this
 * build does not know that version. Callers must treat null as "unknown
 * terms", never as "no trial".
 */
export function findOfferByVersion(
  product: BillingProduct,
  version: string | null | undefined,
): BillingOffer | null {
  const normalized = version?.trim();
  if (!normalized) return null;
  const offer = BILLING_OFFERS[`${product}_AU`];
  return offer && offer.version === normalized ? offer : null;
}

/** True when this offer runs a card-collected Stripe Checkout trial. */
export function offerRunsCheckoutTrial(offer: BillingOffer): boolean {
  return offer.trialStart === "stripe_checkout_trial" && offer.trialDays > 0;
}

/**
 * Ad studio offer versions whose terms included a card-collected Checkout
 * trial, recorded explicitly so trial state resolves from cohort membership.
 *
 * This replaces inferring a trial from "the offer version is not the current
 * one". That inference changed meaning on every version bump and could not
 * distinguish a legacy trial cohort from a brand-new no-trial offer.
 *
 * Add a version here when its terms include a Checkout trial. Remove one only
 * once no subscription created under it can still be live. The guard test in
 * tests/progressive-billing.test.ts fails when the current ad studio offer
 * version is missing, so bumping the version forces a deliberate decision.
 */
export const AD_STUDIO_CHECKOUT_TRIAL_VERSIONS: readonly string[] = [
  "2026-07-27",
  "2026-07-30",
  AD_STUDIO_TRIAL_OFFER_VERSION,
];

/** True when an accepted ad studio offer version carried a Checkout trial. */
export function offerVersionRunsCheckoutTrial(
  product: BillingProduct,
  version: string | null | undefined,
): boolean {
  if (product !== "ad_studio") return false;
  const normalized = version?.trim();
  return normalized ? AD_STUDIO_CHECKOUT_TRIAL_VERSIONS.includes(normalized) : false;
}
