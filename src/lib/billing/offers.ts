export const BILLING_OFFER_VERSION = "2026-09-06";

// Blockwise launches in Australia only. US offers are intentionally absent;
// reintroducing a market means adding its offers back and widening
// isBillingMarket/currencyForMarket together with the signup and onboarding UI.
export type BillingMarket = "AU";
export type BillingCurrency = "AUD";
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
  trialDays: number;
  taxBehavior: StripeTaxBehavior;
  priceEnvKey: string;
  triggeringRule: string;
  checkoutDisclosure: string;
};

const SELF_SERVE_TRIGGER =
  "The free trial — three complete ads and one trial campaign — happens before Checkout and never requires a card. The paid subscription starts when Checkout completes and the first invoice is paid.";

export const BILLING_OFFERS: Readonly<Record<`${BillingProduct}_${BillingMarket}`, BillingOffer>> = {
  self_serve_AU: {
    key: "self_serve_AU",
    version: BILLING_OFFER_VERSION,
    market: "AU",
    currency: "AUD",
    product: "self_serve",
    recurringAmount: 24_900,
    firstInvoiceAmount: 24_900,
    trialDays: 0,
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_SELF_SERVE_AUD_PRICE_ID",
    triggeringRule: SELF_SERVE_TRIGGER,
    checkoutDisclosure:
      "One trial campaign is included before you subscribe. Meta ad spend is separate. Your Blockwise subscription starts at A$249 monthly until cancelled. Prices include GST where Blockwise is required to collect it.",
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
    taxBehavior: "inclusive",
    priceEnvKey: "STRIPE_MANAGED_AUD_PRICE_ID",
    triggeringRule: "The managed service starts when its first invoice is paid.",
    checkoutDisclosure:
      "Managed service starts at A$1,500 monthly. Meta ad spend is separate. Additional brands, ad accounts, or campaign volume require a written scope change.",
  },
};

export function isBillingMarket(value: unknown): value is BillingMarket {
  return value === "AU";
}

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === "AUD";
}

export function isBillingProduct(value: unknown): value is BillingProduct {
  return value === "self_serve" || value === "managed";
}

export function currencyForMarket(_market: BillingMarket): BillingCurrency {
  return "AUD";
}

export function getBillingOffer(market: BillingMarket, product: BillingProduct): BillingOffer {
  return BILLING_OFFERS[`${product}_${market}`];
}
