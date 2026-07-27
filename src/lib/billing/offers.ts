export const BILLING_OFFER_VERSION = "2026-07-27";

export type BillingMarket = "US" | "AU";
export type BillingCurrency = "USD" | "AUD";
export type BillingProduct = "self_serve" | "managed";
export type StripeTaxBehavior = "exclusive" | "inclusive";

export type BillingOffer = {
  key: `${BillingProduct}_${BillingMarket}`;
  version: typeof BILLING_OFFER_VERSION;
  market: BillingMarket;
  currency: BillingCurrency;
  product: BillingProduct;
  recurringAmount: number;
  firstInvoiceAmount: number;
  discountAmount: number;
  trialDays: number;
  taxBehavior: StripeTaxBehavior;
  priceEnvKey: string;
  couponEnvKey: string | null;
  triggeringRule: string;
  checkoutDisclosure: string;
};

const SELF_SERVE_TRIGGER =
  "The subscription starts when the first campaign launches or seven days after Checkout, whichever comes first.";

export const BILLING_OFFERS: Readonly<Record<`${BillingProduct}_${BillingMarket}`, BillingOffer>> = {
  self_serve_US: {
    key: "self_serve_US",
    version: BILLING_OFFER_VERSION,
    market: "US",
    currency: "USD",
    product: "self_serve",
    recurringAmount: 49_900,
    firstInvoiceAmount: 9_900,
    discountAmount: 40_000,
    trialDays: 7,
    taxBehavior: "exclusive",
    priceEnvKey: "STRIPE_SELF_SERVE_USD_PRICE_ID",
    couponEnvKey: "STRIPE_SELF_SERVE_USD_INTRO_COUPON_ID",
    triggeringRule: SELF_SERVE_TRIGGER,
    checkoutDisclosure:
      "One live campaign setup is free. Meta ad spend is separate. Your Blockwise subscription starts at US$99 when the campaign launches or seven days after checkout, whichever comes first, then renews at US$499 monthly until cancelled.",
  },
  self_serve_AU: {
    key: "self_serve_AU",
    version: BILLING_OFFER_VERSION,
    market: "AU",
    currency: "AUD",
    product: "self_serve",
    recurringAmount: 49_900,
    firstInvoiceAmount: 9_900,
    discountAmount: 40_000,
    trialDays: 7,
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_SELF_SERVE_AUD_PRICE_ID",
    couponEnvKey: "STRIPE_SELF_SERVE_AUD_INTRO_COUPON_ID",
    triggeringRule: SELF_SERVE_TRIGGER,
    checkoutDisclosure:
      "One live campaign setup is free. Meta ad spend is separate. Your Blockwise subscription starts at A$99 when the campaign launches or seven days after checkout, whichever comes first, then renews at A$499 monthly until cancelled.",
  },
  managed_US: {
    key: "managed_US",
    version: BILLING_OFFER_VERSION,
    market: "US",
    currency: "USD",
    product: "managed",
    recurringAmount: 150_000,
    firstInvoiceAmount: 150_000,
    discountAmount: 0,
    trialDays: 0,
    taxBehavior: "exclusive",
    priceEnvKey: "STRIPE_MANAGED_USD_PRICE_ID",
    couponEnvKey: null,
    triggeringRule: "The managed service starts when its first invoice is paid.",
    checkoutDisclosure:
      "Managed service starts at US$1,500 monthly. Meta ad spend is separate. Additional brands, ad accounts, or campaign volume require a written scope change.",
  },
  managed_AU: {
    key: "managed_AU",
    version: BILLING_OFFER_VERSION,
    market: "AU",
    currency: "AUD",
    product: "managed",
    recurringAmount: 250_000,
    firstInvoiceAmount: 250_000,
    discountAmount: 0,
    trialDays: 0,
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_MANAGED_AUD_PRICE_ID",
    couponEnvKey: null,
    triggeringRule: "The managed service starts when its first invoice is paid.",
    checkoutDisclosure:
      "Managed service starts at A$2,500 monthly. Meta ad spend is separate. Additional brands, ad accounts, or campaign volume require a written scope change.",
  },
};

export function isBillingMarket(value: unknown): value is BillingMarket {
  return value === "US" || value === "AU";
}

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === "USD" || value === "AUD";
}

export function isBillingProduct(value: unknown): value is BillingProduct {
  return value === "self_serve" || value === "managed";
}

export function currencyForMarket(market: BillingMarket): BillingCurrency {
  return market === "US" ? "USD" : "AUD";
}

export function getBillingOffer(market: BillingMarket, product: BillingProduct): BillingOffer {
  return BILLING_OFFERS[`${product}_${market}`];
}

