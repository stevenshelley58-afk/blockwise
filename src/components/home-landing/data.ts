/**
 * Owner-approved content data for the public homepage.
 */

import { formatBillingAmount, getBillingOffer } from "@/lib/billing/offers";

const AU_SELF_SERVE = getBillingOffer("AU", "self_serve");
const AU_MANAGED = getBillingOffer("AU", "managed");
const AU_FIRST_MONTH = formatBillingAmount(
  AU_SELF_SERVE.firstInvoiceAmount,
  AU_SELF_SERVE.currency,
);
const AU_RENEWAL = formatBillingAmount(
  AU_SELF_SERVE.recurringAmount,
  AU_SELF_SERVE.currency,
);
const AU_MANAGED_MONTHLY = formatBillingAmount(
  AU_MANAGED.recurringAmount,
  AU_MANAGED.currency,
);

export const FAQ_DATA = [
  {
    q: "Who pays for ad spend?",
    a: "You do. Ads run through your Meta ad account and you pay Meta directly.",
  },
  {
    q: "Do I need a Meta ad account?",
    a: "Review your ads first. Connect Meta when you want to go live.",
  },
  {
    q: "Can I approve ads before they run?",
    a: "Yes. Nothing launches until you approve copy, creative, lead form, budget and schedule.",
  },
  {
    q: "What do I get before paying?",
    a: "Three complete Feed + Story ads, free. No card needed.",
  },
  {
    q: "When does the subscription start?",
    a: `After Checkout, the seven-day billing trial ends when your first campaign launches or after seven days, whichever comes first. The first paid month is ${AU_FIRST_MONTH}, then ${AU_RENEWAL}/mo. Cancel anytime.`,
  },
  {
    q: "What does managed include?",
    a: `${AU_MANAGED_MONTHLY}/mo, plus ad spend. Includes self-serve access, launch and weekly optimization for up to four campaigns, one brand, one ad account, and a monthly report.`,
  },
] as const;

export const HERO_RAIL = [
  { k: "Angle", v: "Free appraisal" },
  { k: "Creative", v: "Prepared" },
  { k: "Lead form", v: "Ready" },
  { k: "Budget", v: "$25/day" },
  { k: "Updates", v: "Dashboard" },
] as const;

/**
 * Curated feed templates for the #start studio. Each entry references a real
 * AdStudio sample image directly (no gallery JSON in the landing bundle) and
 * carries short, realistic copy so the live preview reads at a glance.
 */
export const START_TEMPLATES = [
  {
    id: "free-appraisal",
    label: "Free appraisal",
    imageSrc: "/adstudio-samples/meta/meta-appraisal-feed-002-832.webp",
    copy: "Thinking of selling? Find out what your home could be worth with a free property appraisal.",
    footHeading: "Find out what your home could be worth",
    footSub: "Book a free property appraisal",
  },
  {
    id: "seller-consult",
    label: "Seller consult",
    imageSrc: "/adstudio-samples/meta/meta-seller-consult-feed-097-832.webp",
    copy: "Curious what buyers would pay for your home? Get a free, no-obligation consultation.",
    footHeading: "Free seller consultation",
    footSub: "Local market expertise",
  },
  {
    id: "buyers-wanted",
    label: "Buyers wanted",
    imageSrc: "/adstudio-samples/meta/meta-buyers-wanted-feed-126-832.webp",
    copy: "We have qualified buyers waiting for homes like yours. List with us and meet them.",
    footHeading: "Meet ready buyers",
    footSub: "Sell faster",
  },
  {
    id: "market-report",
    label: "Market report",
    imageSrc: "/adstudio-samples/meta/meta-market-report-feed-139-832.webp",
    copy: "What's your suburb really worth right now? Get the latest market report for your area.",
    footHeading: "Free suburb market report",
    footSub: "Updated monthly",
  },
  {
    id: "offmarket-alerts",
    label: "Off-market alerts",
    imageSrc: "/adstudio-samples/meta/meta-offmarket-alerts-feed-130-832.webp",
    copy: "See homes for sale before they hit the market. Get off-market alerts for your suburb.",
    footHeading: "Off-market property alerts",
    footSub: "Be first to know",
  },
  {
    id: "agent-intro",
    label: "Agent intro",
    imageSrc: "/adstudio-samples/meta/meta-agent-intro-feed-037-832.webp",
    copy: "Meet your local agent. Trusted advice, real results, and a plan for your next move.",
    footHeading: "Meet your local agent",
    footSub: "Trusted local expertise",
  },
] as const;

export const CONTROL_POINTS = [
  "Approve every ad before it goes live",
  "Use your own Meta ad account",
  "Control the budget and schedule",
  "See every result in one dashboard",
] as const;

export const DASH_ROWS = [
  {
    name: "Mt Lawley appraisal",
    sub: "Seller lead angle",
    status: "Active",
    tone: "active",
    clicks: "247",
    leads: "18",
    spend: "$324",
  },
  {
    name: "Subiaco just listed",
    sub: "Listing attention",
    status: "Active",
    tone: "active",
    clicks: "182",
    leads: "11",
    spend: "$210",
  },
  {
    name: "Cottesloe open home",
    sub: "Open home traffic",
    status: "Paused",
    tone: "quiet",
    clicks: "93",
    leads: "7",
    spend: "$98",
  },
  {
    name: "South Perth market update",
    sub: "Seller proof",
    status: "Draft",
    tone: "quiet",
    clicks: "--",
    leads: "--",
    spend: "--",
  },
] as const;

export const CHART_POINTS =
  "0,74 40,70 80,72 120,62 160,64 200,52 240,55 280,44 320,47 360,36 400,38 440,28 480,30 520,20 560,16";
