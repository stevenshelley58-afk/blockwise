/**
 * Content data for the homepage redesign. Values are copied verbatim from the
 * design handoff (`renderVals()` in the .dc.html references) — copy is final.
 */

export const FAQ_DATA = [
  {
    q: "Who pays for ad spend?",
    a: "You do. Your ads run through your connected ad account and your ad spend is paid to the platform directly. Blockwise is the software used to build, approve, export and track your ads.",
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
    q: "What happens after the 7 days?",
    a: "Your free access pauses and we ask you to pick a plan. We never took a card, so there is no surprise charge. Your drafts stay put.",
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

export const STUCK_TASKS = [
  { name: "Pick suburb audience", sub: "Meta targeting choices", status: "Needs review" },
  { name: "Write seller lead copy", sub: "Hooks, headline, CTA", status: "Draft again" },
  { name: "Resize listing image", sub: "Feed, story, reels", status: "Wrong size" },
  { name: "Set lead form questions", sub: "Contact, suburb, intent", status: "Not ready" },
  { name: "Send vendor update", sub: "Spend, leads, result", status: "Still pending" },
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
    statusColor: "#3D806A",
    clicks: "247",
    leads: "18",
    spend: "$324",
  },
  {
    name: "Subiaco just listed",
    sub: "Listing attention",
    status: "Active",
    statusColor: "#3D806A",
    clicks: "182",
    leads: "11",
    spend: "$210",
  },
  {
    name: "Cottesloe open home",
    sub: "Open home traffic",
    status: "Paused",
    statusColor: "#8B97A5",
    clicks: "93",
    leads: "7",
    spend: "$98",
  },
  {
    name: "South Perth market update",
    sub: "Seller proof",
    status: "Draft",
    statusColor: "#8B97A5",
    clicks: "--",
    leads: "--",
    spend: "--",
  },
] as const;

export const DASH_TILES = [
  {
    label: "Status",
    body: "See what is live, paused or waiting.",
    value: "Live",
    valueColor: "#3D806A",
  },
  { label: "Spend", body: "Know what has been spent.", value: "$186", valueColor: "#F1F3F4" },
  {
    label: "Results",
    body: "Track clicks and leads in one place.",
    value: "17 leads",
    valueColor: "#F1F3F4",
  },
  {
    label: "Next step",
    body: "Know when something needs approval.",
    value: "Review",
    valueColor: "#5F8FCE",
  },
] as const;

export const CHART_POINTS_DESKTOP =
  "0,74 40,70 80,72 120,62 160,64 200,52 240,55 280,44 320,47 360,36 400,38 440,28 480,30 520,20 560,16";

export const CHART_POINTS_MOBILE =
  "0,64 40,60 80,62 120,54 160,56 200,45 240,48 280,38 320,41 360,31 400,33 440,24 480,26 520,17 560,14";
