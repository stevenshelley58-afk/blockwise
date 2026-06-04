import type { AdStudioGoal } from "./types.ts";

export type AdStudioTemplate = {
  id: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
};

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  active: boolean;
};

export const AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  {
    id: "just_listed",
    name: "Just listed",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Promote a newly listed property and invite local owners to compare their own home.",
  },
  {
    id: "coming_soon",
    name: "Coming soon",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Tease an upcoming listing and create local interest before launch.",
  },
  {
    id: "new_to_market",
    name: "New to market",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Announce fresh local activity and prompt owners to check recent sales context.",
  },
  {
    id: "open_home",
    name: "Open home",
    goal: "open_home_followup",
    offerId: "open_home_followup",
    promptHint: "Promote inspection interest with date, time, property details, and a simple enquiry path.",
  },
  {
    id: "just_sold",
    name: "Just sold",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Use a recent sale as local proof and invite nearby owners to understand their position.",
  },
  {
    id: "price_update",
    name: "Price update",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Offer a practical home value update without making performance guarantees.",
  },
  {
    id: "market_update",
    name: "Market update",
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    promptHint: "Share useful suburb market context for homeowners considering their next move.",
  },
  {
    id: "free_appraisal",
    name: "Free appraisal",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Invite owners to request a no-pressure local price update.",
  },
  {
    id: "buyer_demand",
    name: "Buyer demand",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Explain local buyer demand carefully without over-claiming results.",
  },
  {
    id: "seller_checklist",
    name: "Seller checklist",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    promptHint: "Offer a practical preparation checklist for owners thinking about selling.",
  },
];

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate {
  return AD_STUDIO_TEMPLATES.find((template) => template.id === templateId) ?? AD_STUDIO_TEMPLATES[0];
}

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));
