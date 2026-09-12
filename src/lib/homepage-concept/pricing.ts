/**
 * Public-offer presentation for the homepage concept. This data does not
 * create a subscription or change billing policy.
 */

export type HomepagePlan = {
  readonly id: "free" | "self-serve" | "managed";
  readonly name: string;
  readonly price: string;
  readonly billing: string;
  readonly outcome: string;
  readonly included: readonly string[];
  readonly note?: string;
  readonly details: readonly string[];
  readonly cta: {
    readonly label: string;
    readonly href: string;
    readonly location: string;
  };
  readonly featured: boolean;
};

export const TRIAL_SIGNUP_URL = "https://blockwise.sale/signup?offer=self-serve";
export const TRIAL_CTA_LABEL = "Start your free trial";

export const HOMEPAGE_PLANS: readonly HomepagePlan[] = [
  {
    id: "free",
    name: "Free",
    price: "A$0",
    billing: "No Blockwise subscription fee",
    outcome: "Make your first ads without adding a card.",
    included: ["Three Feed + Story ad packs", "14 days of app access"],
    details: ["Your 14 days start when your first ad begins running", "One trial set of ads sharing one budget", "Your saved ads and leads stay available", "Meta ad spend is paid separately to Meta"],
    note: "You only pay Blockwise if you choose a paid plan.",
    cta: { label: "Create your free account", href: TRIAL_SIGNUP_URL, location: "pricing-free" },
    featured: false,
  },
  {
    id: "self-serve",
    name: "Self-serve",
    price: "A$249",
    billing: "per month, plus Meta ad spend",
    outcome: "Create and manage your own ads.",
    included: ["Up to 50 Feed + Story packs a month", "Your ads, budget and results in one place"],
    note: "Choosing this plan is the paid step. Starting free does not auto-charge you.",
    details: ["One brand, one Meta ad account and five team members", "100 creative updates each billing period. A complete Feed + Story pack uses two updates, while ordinary text edits and repeat downloads use none. Meta ad spend is separate."],
    cta: { label: "Start free, then choose", href: TRIAL_SIGNUP_URL, location: "pricing-self-serve" },
    featured: true,
  },
  {
    id: "managed",
    name: "Managed",
    price: "from A$1,500",
    billing: "per month, plus Meta ad spend",
    outcome: "Get help setting up and managing your ads.",
    included: ["Everything in self-serve", "Weekly improvements and monthly reports"],
    note: "Cancel anytime. Monthly billing, no lock-in.",
    details: ["Up to four live groups of ads managed for you", "We agree the scope and price before payment"],
    cta: { label: "Ask about managed setup", href: "https://blockwise.sale/#managed-setup", location: "pricing-managed" },
    featured: false,
  },
] as const;
