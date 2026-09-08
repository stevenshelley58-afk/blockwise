export const withBasePath = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

export const CONTACT_EMAIL = "hello@blockwise.sale";
export const MANAGED_SETUP_HREF = "https://blockwise.sale/#managed-setup";
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;
export const PRICING_HREF = "https://blockwise.sale/pricing";
export const PRIVACY_HREF = "https://blockwise.sale/privacy";
export const TERMS_HREF = "https://blockwise.sale/terms";
export const LOGIN_HREF = "https://blockwise.sale/login";
export const BUSINESS_IDENTITY = "Blockwise is operated by SHELLEY, STEVEN JOHN.";

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
    { question: "Can I arrange a Perth meeting?", answer: "Yes. Request a Perth meeting by email and we will arrange the details.", links: [{ label: `Email ${CONTACT_EMAIL}`, href: CONTACT_HREF }] },
  ] },
] as const;
