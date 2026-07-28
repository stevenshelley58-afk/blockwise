/**
 * Owner-approved content data for the public homepage.
 */

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
    a: "$499/mo from your first campaign launch. Cancel anytime.",
  },
  {
    q: "What does managed include?",
    a: "$2,000/mo flat, plus ad spend. Everything in self-serve, launch and weekly optimization for up to four campaigns, one brand, one ad account, monthly report.",
  },
] as const;

export const HERO_RAIL = [
  { k: "Angle", v: "Free appraisal" },
  { k: "Creative", v: "Prepared" },
  { k: "Lead form", v: "Ready" },
  { k: "Budget", v: "$25/day" },
  { k: "Updates", v: "Daily email" },
] as const;

export const RADAR_ADS = [
  {
    agency: "Your Agency",
    copy: "What could your Mt Lawley home be worth?",
    foot: "Free seller appraisal",
    angle: "Free appraisal",
    cta: "Learn more",
    src: "/home/mt-lawley-federation.webp",
  },
  {
    agency: "Your Agency",
    copy: "Just listed in Subiaco.",
    copyMobile: "Just listed in Subiaco. Be first through the door.",
    foot: "View this property",
    angle: "Just listed",
    cta: "Learn more",
    src: "/home/subiaco-townhouse.webp",
  },
  {
    agency: "Your Agency",
    copy: "Open home this Saturday.",
    copyMobile: "Open home this Saturday. See inside before you go.",
    foot: "See inside",
    angle: "Open home",
    cta: "Learn more",
    src: "/home/open-home-living.webp",
  },
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

export const PROPERTY_USES = ["Seller prep", "Buyer questions", "Lead follow-up"] as const;

export const PROPERTY_NOTES = [
  {
    text: "Corner lot in a dual-density area. Retain-and-build may apply.",
    source: "Local planning scheme",
  },
  {
    text: "Heritage overlay. External changes may need approval.",
    source: "Heritage list",
  },
  {
    text: "Front setback limits apply. Check before quoting works.",
    source: "R-Codes",
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
