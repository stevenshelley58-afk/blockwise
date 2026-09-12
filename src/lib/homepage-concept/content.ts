export const withBasePath = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

/**
 * The hero deck. Kept here with the rest of the homepage content so the data,
 * its image widths and the responsive-variant build step all read one list.
 */
export type ShowcaseAd = {
  id: string;
  format: "feed" | "story";
  page: string;
  initials: string;
  tone: "navy" | "blue" | "gold" | "charcoal";
  image: string;
  copy: string;
  headline: string;
  domain: string;
};

export const SHOWCASE_ADS: readonly ShowcaseAd[] = [
  { id: "just-listed-feed", format: "feed", page: "Blockwise Realty", initials: "BR", tone: "navy", image: "/home/home-dusk.webp", copy: "Just listed. View the photos, floorplan and inspection times.", headline: "A new address worth seeing", domain: "BLOCKWISEREALTY.COM" },
  { id: "buyers-story", format: "story", page: "West & Co Property", initials: "W&C", tone: "blue", image: "/hero/hero-tall.webp", copy: "Qualified buyers are looking now.", headline: "See buyer demand", domain: "WESTANDCO.COM" },
  { id: "local-advice-feed", format: "feed", page: "Jordan Lee Property", initials: "JL", tone: "charcoal", image: "/home/open-home-living.webp", copy: "Clear advice. Clear next steps. Talk with Jordan about your property plans.", headline: "Book a property call", domain: "JORDANLEE.COM" },
  { id: "appraisal-story", format: "story", page: "Mia Calloway Real Estate", initials: "MC", tone: "gold", image: "/ads/ad-coastline.webp", copy: "Find out what your home could be worth.", headline: "Request an appraisal", domain: "MIACALLOWAY.COM" },
  { id: "first-home-feed", format: "feed", page: "Northside Property", initials: "NP", tone: "navy", image: "/home/mt-lawley-federation.webp", copy: "Buying your first home? Start with the questions that make every inspection easier.", headline: "A smarter first-home checklist", domain: "NORTHSIDEPROPERTY.COM" },
  { id: "mobile-appraisal-story", format: "story", page: "Alex Morgan Property", initials: "AM", tone: "blue", image: "/home/workspace-hero/agent-ad.webp", copy: "Your property appraisal, made simple.", headline: "Book an appraisal", domain: "ALEXMORGAN.COM" },
  { id: "market-report-feed", format: "feed", page: "Harbourline Realty", initials: "HR", tone: "charcoal", image: "/home/home-pool.webp", copy: "Prices, recent sales and buyer activity. See what changed in your market.", headline: "Your market report", domain: "HARBOURLINE.COM" },
  { id: "planning-story", format: "story", page: "Oak & Key Property", initials: "O&K", tone: "gold", image: "/ads/ad-hillview.webp", copy: "Plan your next move with a clearer property checklist.", headline: "Get the checklist", domain: "OAKANDKEY.COM" },
] as const;

export const AD_EXAMPLES = [
  {
    id: "appraisal",
    label: "Free appraisal",
    title: "Start appraisal conversations.",
    body: "A clear homeowner offer, a polished feed creative, and a simple next step.",
    /* A clean pack render, with no text printed on the artwork, so the headline
       the visitor writes is the only headline on the creative. */
    image: "/adstudio-fixtures/meta-agent-intro-feed-037/property-photo.webp",
    postCopy: "Thinking of selling? Find out what your home could be worth with a free property appraisal.",
    linkTitle: "Find out what your home could be worth",
    /* The headline printed on the creative. It is the largest text on the ad,
       so it is the one the link title field writes. */
    adTitle: "Your home could be worth more",
  },
  {
    id: "consult",
    label: "Seller consult",
    title: "A low-pressure first step.",
    body: "Lead with useful expertise and invite a no-obligation conversation.",
    image:
      "/adstudio-thumbnails/meta/6b49016814ffdb9e64eb33943667efda84f3f55e0020d0fc00cbab4f121754d3-preview.webp",
    postCopy: "Curious what buyers would pay for your home? Get a free, no-obligation consultation.",
    linkTitle: "Free seller consultation",
    adTitle: "Book a free seller consultation",
  },
  {
    id: "buyers",
    label: "Buyers wanted",
    title: "Make demand feel immediate.",
    body: "A direct creative gives potential sellers a reason to raise their hand.",
    image:
      "/adstudio-thumbnails/meta/fdc9222b4d16c2666d7767372301545b54679819d1beb3359aef4c05170e59b0-preview.webp",
    postCopy: "We have qualified buyers waiting for homes like yours. List with us and meet them.",
    linkTitle: "Meet ready buyers",
    adTitle: "Buyers are waiting for your home",
  },
  {
    id: "report",
    label: "Market report",
    title: "Useful information for sellers.",
    body: "Create a useful entry point for future sellers who are not ready to book yet.",
    image:
      "/adstudio-thumbnails/meta/eb4bce514070f6ce1566fc8fd2570755157d99eb50518e210739b276a6a1f370-preview.webp",
    postCopy: "What is your market worth right now? Get the latest market report.",
    linkTitle: "Free market report",
    adTitle: "What is your market worth now?",
  },
] as const;

/**
 * Real 4:5 Feed creatives from the Ad Studio library, used by the homepage
 * "how it works" browser. Index 3 is the ad the demo selects, so its copy
 * comes from the matching AD_EXAMPLES entry.
 */
export const AD_LIBRARY = [
  { id: "just-listed", image: "/adstudio-thumbnails/meta/0899efc11fc68e177c731321421454f0001a393bbc8b0211dafad4a7f3b89347-preview.webp" },
  { id: "smart-first-steps", image: "/adstudio-thumbnails/meta/1c119a3dae9089ca621e947afe16c7f5307748d3ea956a826750e61d078fe94c-preview.webp" },
  { id: "open-home", image: "/adstudio-thumbnails/meta/127c60b3d1e238b9289dbe501dba65f249fa99e96fd5be4bd8848733e089fd35-preview.webp" },
  { id: "appraisal", image: AD_EXAMPLES[0].image },
  { id: "thinking-of-selling", image: "/adstudio-thumbnails/meta/6b49016814ffdb9e64eb33943667efda84f3f55e0020d0fc00cbab4f121754d3-preview.webp" },
  { id: "buyers-wanted", image: AD_EXAMPLES[2].image },
  { id: "own-land", image: AD_EXAMPLES[3].image },
  { id: "rental-appraisal", image: "/adstudio-thumbnails/meta/8f909f4b8f396a6d3fa1a3940fccb64292ac3df511761d2d8b72b6b39f0ca8de-preview.webp" },
] as const;

export const CONTACT_EMAIL = "hello@blockwise.sale";
export const MANAGED_SETUP_HREF = "https://blockwise.sale/#managed-setup";
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;
export const PRICING_HREF = "https://blockwise.sale/pricing";
export const PRIVACY_HREF = "https://blockwise.sale/privacy";
export const TERMS_HREF = "https://blockwise.sale/terms";
export const LOGIN_HREF = "https://blockwise.sale/login";
export const BUSINESS_IDENTITY = "Blockwise is operated by SHELLEY, STEVEN JOHN.";

/**
 * Public booking. SnagTime, the self-hosted scheduling service, answers on
 * BOOKING_ORIGIN and serves one page per event type at /book/<slug>. Naming
 * the origin and the slug together keeps the home page link and the published
 * event type from drifting apart. The origin is the canonical value fixed by
 * the SnagTime fork's docs/BLOCKWISE-INTEGRATION.md.
 *
 * The event type behind BOOKING_EVENT_SLUG must be published, public and 20
 * minutes, because BOOKING_POINTS states that length to the visitor.
 */
export const BOOKING_ORIGIN = "https://book.blockwise.sale";
export const BOOKING_EVENT_SLUG = "intro-call";
export const BOOKING_HREF = `${BOOKING_ORIGIN}/book/${BOOKING_EVENT_SLUG}`;

export const BOOKING_POINTS = [
  "20 minutes, by video or phone",
  "No card required",
  "No obligation to continue",
] as const;

/**
 * SnagTime is not serving on BOOKING_ORIGIN yet, and a home page must not offer
 * live availability it cannot show. In "request" mode the section asks for a
 * few times by email and we confirm one; in "live" mode it hands over to
 * SnagTime for a real slot picker. The wording below follows the mode, so
 * switching to "live" is the same one-line change that deploys the scheduler,
 * and the page can never promise a picker that is not there.
 */
export const BOOKING_MODE: "request" | "live" = "request";

export const BOOKING_CALL = {
  request: {
    action: "Request a time",
    detail: "Send us two or three times that suit you and we will confirm one by email.",
    href: `${CONTACT_HREF}?subject=Book%20a%20call`,
  },
  live: {
    action: "See available times",
    detail: "You will see live availability, and you get a confirmation straight away.",
    href: BOOKING_HREF,
  },
} as const;

export type FaqLink = { readonly label: string; readonly href: string };
export type Faq = { readonly question: string; readonly answer: string; readonly links?: readonly FaqLink[] };

export const FAQ_GROUPS = [
  { heading: "Getting started", faqs: [
    { question: "What if I don’t have a Meta ad account?", answer: "We can help you set up a Meta ad account and connect it to Blockwise." },
    { question: "What do I need to provide?", answer: "Your email to start, then your branding, photos and ad details. You review everything before launch." },
    { question: "How does managed service start?", answer: "We agree the scope and price before anything starts.", links: [{ label: "Managed setup", href: MANAGED_SETUP_HREF }, { label: `Email ${CONTACT_EMAIL}`, href: CONTACT_HREF }] },
  ] },
  { heading: "Plans", faqs: [
    { question: "What does the free option include?", answer: "Three Feed and Story packs. No card is needed." },
    { question: "What happens after the free allowance?", answer: "Saved designs and leads stay available. You only pay Blockwise if you choose a paid plan." },
  ] },
  { heading: "Costs", faqs: [
    { question: "What does self-serve cost?", answer: "A$249 per month until cancelled. Meta ad spend is separate." },
    { question: "Is Meta ad spend included?", answer: "No. You pay Meta directly through your own ad account." },
    { question: "How are taxes and extras handled?", answer: "GST is included where required. Extra brands, accounts or campaigns are quoted separately." },
  ] },
  { heading: "Billing", faqs: [
    { question: "Will the free option charge my card?", answer: "No. You only pay Blockwise if you choose a paid plan." },
    { question: "How do I cancel self-serve?", answer: "Cancel in billing settings or the Stripe portal to stop renewals. Paid access and remaining credits last until the billing period ends." },
  ] },
  { heading: "Ownership and support", faqs: [
    { question: "Who owns my ad account and ad data?", answer: "You do. Your saved designs and leads stay available." },
    { question: "Does Blockwise guarantee leads or sales?", answer: "No. Results depend on your market, offer, budget and follow-up." },
    { question: "What support is included?", answer: "Self-serve includes help when you are stuck. Managed adds setup and weekly campaign reviews." },
  ] },
  { heading: "Let’s talk", faqs: [
    { question: "Can I talk to someone before choosing?", answer: "Yes. Email us and we will arrange a time.", links: [{ label: `Email ${CONTACT_EMAIL}`, href: CONTACT_HREF }] },
    { question: "Can I ask about managed setup?", answer: "Yes. Email us and we will explain the setup options.", links: [{ label: `Email ${CONTACT_EMAIL}`, href: CONTACT_HREF }] },
  ] },
] as const;
