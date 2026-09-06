/**
 * Owner-approved content data for the public homepage.
 */

export const FAQ_DATA = [
  {
    q: "Who pays for ad spend?",
    a: "You do. Your ads run through your connected Meta ad account and you pay Meta directly. Blockwise does not include, mark up, or silently fund your media spend.",
  },
  {
    q: "Do I need a Meta ad account?",
    a: "You can review your ads before connecting Meta. To move from draft to live, connect your Meta ad account for final setup.",
  },
  {
    q: "Can I approve ads before they run?",
    a: "Yes. Nothing is sent for launch until your team approves the copy, creative, lead form, budget and schedule.",
  },
  {
    q: "Can I see results inside Blockwise?",
    a: "Yes. Once your ads are connected, Blockwise shows status, spend, clicks, leads and performance metrics inside the app.",
  },
  {
    q: "Are the ads checked before export?",
    a: "Blockwise flags common property advertising risks and brand issues before approval. Your agency remains responsible for final review, claims, pricing language and export.",
  },
  {
    q: "What do I get before paying?",
    a: "You can create three complete Feed + Story ads without a card, and one live trial campaign is included before you subscribe. You approve the campaign's budget and end date with Meta before it starts — free means no Blockwise subscription fee, not free advertising.",
  },
  {
    q: "What is included after I subscribe?",
    a: "Self-serve includes 100 render credits each month, enough for up to 50 complete Feed + Story packs when each pack uses two renders, plus five verified team members.",
  },
  {
    q: "When does the self-serve subscription start?",
    a: "Only when you choose to subscribe. Checkout collects a card and starts US$149 (United States) or A$249 (Australia) monthly until cancelled. There is no introductory price and no automatic charge at the end of the trial. Checkout uses the market and local currency you confirm.",
  },
  {
    q: "Do unused render credits roll over?",
    a: "No. Paid self-serve includes 100 render credits per billing period. Credits expire at the end of that period and do not roll over or transfer. Cancellation stops future credit grants; credits you have already paid for remain available until the current period ends.",
  },
  {
    q: "Does deleting my account cancel the subscription?",
    a: "No. Cancel through Blockwise billing settings or the Stripe billing portal to stop future renewals. Deleting a profile, workspace, or creative is not a substitute for cancelling. After cancellation, paid access and remaining credits continue until the end of the current billing period.",
  },
  {
    q: "What does managed service include?",
    a: "Managed service starts at US$1,500/month in the United States or A$2,500/month in Australia, plus Meta ad spend. It includes the complete self-serve product, 100 monthly render credits, one brand, one Meta ad account, operator launch and weekly optimization of up to four live campaigns, and a monthly report. You pay Meta directly; additional scope is confirmed and repriced during onboarding.",
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
 * Curated feed templates for the #start studio. Each entry references an
 * immutable, content-hashed AdStudio preview directly (no gallery JSON in the
 * landing bundle) and carries short, realistic copy so the live preview reads
 * at a glance.
 */
export const START_TEMPLATES = [
  {
    id: "free-appraisal",
    label: "Free appraisal",
    imageSrc:
      "/adstudio-thumbnails/meta/f1eef3fb49b782ab7666cd14a7f793151f5fd439c724085ce68996e9ebb24f78-preview.webp",
    copy: "Thinking of selling? Find out what your home could be worth with a free property appraisal.",
    footHeading: "Find out what your home could be worth",
    footSub: "Book a free property appraisal",
  },
  {
    id: "seller-consult",
    label: "Seller consult",
    imageSrc:
      "/adstudio-thumbnails/meta/e5f5c79cf1406642a592ca040d4b93a2ac7dca8d79e0ac4c437c2a8f70a337ec-preview.webp",
    copy: "Curious what buyers would pay for your home? Get a free, no-obligation consultation.",
    footHeading: "Free seller consultation",
    footSub: "Local market expertise",
  },
  {
    id: "buyers-wanted",
    label: "Buyers wanted",
    imageSrc:
      "/adstudio-thumbnails/meta/fdc9222b4d16c2666d7767372301545b54679819d1beb3359aef4c05170e59b0-preview.webp",
    copy: "We have qualified buyers waiting for homes like yours. List with us and meet them.",
    footHeading: "Meet ready buyers",
    footSub: "Sell faster",
  },
  {
    id: "market-report",
    label: "Market report",
    imageSrc:
      "/adstudio-thumbnails/meta/eb4bce514070f6ce1566fc8fd2570755157d99eb50518e210739b276a6a1f370-preview.webp",
    copy: "What's your suburb really worth right now? Get the latest market report for your area.",
    footHeading: "Free suburb market report",
    footSub: "Updated monthly",
  },
  {
    id: "offmarket-alerts",
    label: "Off-market alerts",
    imageSrc:
      "/adstudio-thumbnails/meta/b0bb808e7012fa214616e43564a3541afabe23064c7bf05a0391f1ca640b5460-preview.webp",
    copy: "See homes for sale before they hit the market. Get off-market alerts for your suburb.",
    footHeading: "Off-market property alerts",
    footSub: "Be first to know",
  },
  {
    id: "agent-intro",
    label: "Agent intro",
    imageSrc:
      "/adstudio-thumbnails/meta/0d83ce43550e78876dc2958337f92e2fa438b9aaa90778058a5b1ad14f7c1064-preview.webp",
    copy: "Meet your local agent. Trusted advice, real results, and a plan for your next move.",
    footHeading: "Meet your local agent",
    footSub: "Trusted local expertise",
  },
] as const;

export const PROPERTY_USES = [
  { title: "Seller appraisal prep", body: "Walk in with useful property signals, not guesses." },
  {
    title: "Buyer questions",
    body: "Answer common build, extend, renovate, and subdivision questions with source-cited notes.",
  },
  { title: "Lead follow-up", body: "Turn ad leads into better client conversations." },
] as const;

export const PROPERTY_NOTES = [
  {
    text: "Corner lot in a dual-density code area; retain-and-build may apply.",
    source: "Local planning scheme",
  },
  {
    text: "Heritage area overlay noted; external changes may need approval.",
    source: "Heritage list",
  },
  {
    text: "Renovation limits apply to front setback; check before quoting works.",
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
