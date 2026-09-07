export const EMAIL_KINDS = [
  "sign-in", "welcome", "lead-alert", "weekly-digest", "receipt", "security", "update",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type EmailMessage = {
  kind: EmailKind;
  eyebrow: string;
  subject: string;
  preheader: string;
  greeting: string;
  heading: string;
  intro: string;
  action: { label: string; href: string };
  oneTimeCode?: string;
  details?: ReadonlyArray<{ label: string; value: string }>;
  note?: string;
  signOff?: string;
  transactional: boolean;
};

export const EMAIL_FIXTURES: Record<EmailKind, EmailMessage> = {
  "sign-in": {
    kind: "sign-in", eyebrow: "SECURE SIGN-IN", subject: "Your Blockwise sign-in link", preheader: "Sign in securely, or use your one-time code.", greeting: "Hello Jordan,", heading: "Sign in to Blockwise", intro: "Use the secure link below to sign in. Your link and one-time code expire in 10 minutes.", oneTimeCode: "482913", action: { label: "Sign in to Blockwise", href: "https://preview.blockwise.example/sign-in" }, note: "If you did not request this code, you can safely ignore this email.", transactional: true,
  },
  welcome: {
    kind: "welcome", eyebrow: "WELCOME TO BLOCKWISE", subject: "Your workspace is ready", preheader: "Start with the next useful action.", greeting: "Hello Jordan,", heading: "Your workspace is ready", intro: "Blockwise is ready when you are. Start by setting up the listing you want to promote.", action: { label: "Open your workspace", href: "https://preview.blockwise.example/workspace" }, details: [{ label: "Workspace", value: "Northline Realty" }, { label: "Next step", value: "Create your first campaign" }], signOff: "The Blockwise team", transactional: true,
  },
  "lead-alert": {
    kind: "lead-alert", eyebrow: "NEW LEAD", subject: "A new enquiry needs a response", preheader: "Taylor has enquired about 18 Seabrook Lane.", greeting: "Hello Jordan,", heading: "A new enquiry is waiting", intro: "Taylor Nguyen asked for more information about your current campaign. A timely reply keeps the conversation moving.", action: { label: "Review lead", href: "https://preview.blockwise.example/leads/lead-42" }, details: [{ label: "Campaign", value: "18 Seabrook Lane" }, { label: "Received", value: "Today, 9:42 am" }, { label: "Preferred contact", value: "Email" }], transactional: true,
  },
  "weekly-digest": {
    kind: "weekly-digest", eyebrow: "WEEKLY SUMMARY", subject: "Your Blockwise week in review", preheader: "A concise view of this week’s campaign activity.", greeting: "Hello Jordan,", heading: "Your week, in brief", intro: "Here is the operational picture for Northline Realty, for the week ending 6 September.", action: { label: "View campaign activity", href: "https://preview.blockwise.example/activity" }, details: [{ label: "New enquiries", value: "14" }, { label: "Campaigns live", value: "3" }, { label: "Items needing review", value: "2" }], note: "Figures are a summary for planning, not a final billing record.", transactional: false,
  },
  receipt: {
    kind: "receipt", eyebrow: "PAYMENT RECEIPT", subject: "Your Blockwise receipt", preheader: "A receipt for your September subscription.", greeting: "Hello Jordan,", heading: "Payment received", intro: "Thanks. We have recorded your subscription payment for Northline Realty.", action: { label: "View billing details", href: "https://preview.blockwise.example/billing" }, details: [{ label: "Amount", value: "A$249.00" }, { label: "Reference", value: "BW-2048" }, { label: "Paid", value: "6 September 2026" }], transactional: true,
  },
  security: {
    kind: "security", eyebrow: "SECURITY NOTICE", subject: "A new sign-in to your Blockwise account", preheader: "Review this sign-in if it was not you.", greeting: "Hello Jordan,", heading: "New sign-in detected", intro: "We noticed a sign-in to your account. If this was you, there is nothing else to do.", action: { label: "Review account security", href: "https://preview.blockwise.example/security" }, details: [{ label: "When", value: "6 September 2026, 10:14 am" }, { label: "Device", value: "Desktop browser" }, { label: "Location", value: "Perth, Australia" }], note: "If this was not you, review your account security as soon as possible.", transactional: true,
  },
  update: {
    kind: "update", eyebrow: "PRODUCT UPDATE", subject: "A calmer way to review campaign work", preheader: "A short note from Blockwise.", greeting: "Hello Jordan,", heading: "A clearer review flow", intro: "This week we refined the campaign review view so key checks are easier to scan before work goes live.", action: { label: "Read the update", href: "https://preview.blockwise.example/updates" }, signOff: "The Blockwise team", transactional: false,
  },
};

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  "sign-in": "Sign-in code", welcome: "Welcome", "lead-alert": "Lead alert", "weekly-digest": "Weekly digest", receipt: "Receipt & billing", security: "Security notice", update: "Product update",
};
