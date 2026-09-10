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
    included: ["Three Feed + Story ad packs", "One campaign"],
    details: ["Saved designs and leads stay available", "Meta ad spend is paid separately to Meta"],
    note: "You only pay Blockwise if you choose a paid plan.",
    cta: { label: TRIAL_CTA_LABEL, href: TRIAL_SIGNUP_URL, location: "pricing-free" },
    featured: false,
  },
  {
    id: "self-serve",
    name: "Self-serve",
    price: "A$249",
    billing: "Plus Meta ad spend",
    outcome: "Create and manage your own ads.",
    included: ["100 render credits each month", "Up to 50 Feed + Story ad packs"],
    note: "Cancel anytime. Monthly billing, no lock-in.",
    details: ["Five team members, one brand and one Meta ad account", "Help when you need it. Meta ad spend is separate."],
    cta: { label: TRIAL_CTA_LABEL, href: TRIAL_SIGNUP_URL, location: "pricing-self-serve" },
    featured: true,
  },
  {
    id: "managed",
    name: "Managed",
    price: "from A$1,500",
    billing: "per month, plus Meta ad spend",
    outcome: "Get help setting up and managing your ads.",
    included: ["Everything in self-serve", "Up to four live campaigns"],
    note: "Cancel anytime. Monthly billing, no lock-in.",
    details: ["Weekly campaign improvements and a monthly report", "Scope and price are agreed in writing before payment"],
    cta: { label: "Ask about managed setup", href: "https://blockwise.sale/#managed-setup", location: "pricing-managed" },
    featured: false,
  },
] as const;
