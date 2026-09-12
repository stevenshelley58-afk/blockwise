/** New lead email template. Static preview only — nothing is addressed or sent. */
import { REPORT_EXAMPLE } from "./reporting";

export const LEAD_EMAIL_TEMPLATE = {
  id: "new-lead",
  version: 1,
  subject: "New lead",
  previewLabel: "New lead email",
  intro: `A new lead just arrived.`,
  action: "View lead",
  creative: {
    src: "/ads/ad-hillview.jpg",
    alt: `Ad creative for ${REPORT_EXAMPLE.campaign}`,
    label: REPORT_EXAMPLE.campaign,
  },
  details: [
    { label: "Enquiry", value: "Property appraisal" },
    { label: "Source", value: REPORT_EXAMPLE.lead.source },
    { label: "Received", value: REPORT_EXAMPLE.lead.received },
  ],
  privacy: "Contact details and the full enquiry are available securely in Blockwise.",
  signOff: "The Blockwise team",
  preferenceNote: "You chose to get new lead alerts.",
  preferenceLinks: ["Manage preferences", "Unsubscribe from new lead alerts"],
  supportLink: "Help and support",
} as const;
