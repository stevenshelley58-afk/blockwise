import type { AdStudioGoal } from "@/lib/adstudio";

export type AngleCard = {
  id: string;
  name: string;
  purpose: string;
  bestFor: string;
  goal: AdStudioGoal;
  offerId: string;
  variantLabel: string;
};

export const ANGLES: AngleCard[] = [
  {
    id: "free_appraisal",
    name: "Free Appraisal",
    purpose: "Direct seller lead capture",
    bestFor: "appraisal enquiries",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    variantLabel: "Direct appraisal",
  },
  {
    id: "buyer_demand",
    name: "Buyer Demand",
    purpose: "Show active demand without over-claiming",
    bestFor: "vendor leads",
    goal: "seller_leads",
    offerId: "home_value_update",
    variantLabel: "Buyer demand",
  },
  {
    id: "recent_sale",
    name: "Recent Sale",
    purpose: "Turn local proof into seller interest",
    bestFor: "warm owners",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    variantLabel: "Recent activity",
  },
  {
    id: "market_update",
    name: "Market Update",
    purpose: "Useful local market report offer",
    bestFor: "passive owners",
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    variantLabel: "Market update",
  },
  {
    id: "open_home",
    name: "Open Home",
    purpose: "Promote inspection interest",
    bestFor: "open homes",
    goal: "open_home_followup",
    offerId: "open_home_followup",
    variantLabel: "Open home",
  },
  {
    id: "low_stock",
    name: "Low Stock",
    purpose: "Create urgency from market context",
    bestFor: "seller intent",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    variantLabel: "Low stock",
  },
  {
    id: "home_values",
    name: "Home Values",
    purpose: "Prompt owners to check value",
    bestFor: "home value leads",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    variantLabel: "Home value angle",
  },
  {
    id: "investor_update",
    name: "Investor Update",
    purpose: "Local snapshot for investors",
    bestFor: "investor leads",
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    variantLabel: "Investor update",
  },
];
