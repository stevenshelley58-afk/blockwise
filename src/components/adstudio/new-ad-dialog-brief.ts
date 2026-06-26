import type { AdStudioTemplate } from "../../lib/adstudio/index.ts";

type BriefCategory = "listing" | "appraisal" | "market" | "open_home" | "sold" | "general";

export type TemplateBriefGuidance = {
  fieldLabel: string;
  helperText: string;
  note: string;
  placeholder: string;
};

const BLANK_BRIEF_GUIDANCE: TemplateBriefGuidance = {
  fieldLabel: "Short description",
  helperText: "Include the property, suburb, offer, or key selling point.",
  note: "Add your own photo and a short brief so Blockwise can build the ad.",
  placeholder: "Example: Open home this Saturday, 3 bed family home in Scarborough with renovated kitchen.",
};

export function briefGuidanceForTemplate(
  template: Pick<AdStudioTemplate, "goal" | "name" | "offerId" | "promptHint" | "sampleCopy" | "sampleStyle"> | undefined,
  isBlank: boolean,
): TemplateBriefGuidance {
  if (isBlank || !template) return BLANK_BRIEF_GUIDANCE;

  const category = briefCategoryForTemplate(template);
  const style = template.sampleStyle;
  const suburb = [style?.sampleSuburb, style?.sampleState].filter(Boolean).join(", ") || "Scarborough, WA";
  const address = style?.address || "18 Tallow Lane";
  const property = style?.propertyDetail || "3 bed family home";
  const result = style?.resultDetail || "Saturday 10:30am";

  const guidance = guidanceByCategory(category, { address, property, result, suburb });
  const note = `${template.name} selected. Add the real details for this campaign; sample details stay as examples only.`;

  return {
    ...guidance,
    note,
    placeholder: `Example: ${guidance.placeholder}`,
  };
}

function briefCategoryForTemplate(
  template: Pick<AdStudioTemplate, "goal" | "offerId" | "promptHint">,
): BriefCategory {
  switch (template.goal) {
    case "market_update_leads":
      return "market";
    case "open_home_followup":
      return "open_home";
    case "listing_nurture":
      return "sold";
    case "appraisal_bookings":
    case "downsizer_leads":
    case "investor_leads":
      return "appraisal";
    case "seller_leads":
    case "buyer_leads":
      return "listing";
  }

  const offer = template.offerId.toLowerCase();
  const hint = template.promptHint.toLowerCase();
  const text = `${offer} ${hint}`;

  if (/market[_ -]?update|suburb[_ -]?market[_ -]?report|suburb report|median|stat/u.test(text)) {
    return "market";
  }
  if (/open home|inspection/u.test(text)) {
    return "open_home";
  }
  if (/sold|nurture|testimonial|result/u.test(text)) {
    return "sold";
  }
  if (/appraisal|home value|investor|downsizer/u.test(text)) {
    return "appraisal";
  }
  if (/listing|buyer|property/u.test(text)) {
    return "listing";
  }

  return "general";
}

function guidanceByCategory(
  category: BriefCategory,
  sample: { address: string; property: string; result: string; suburb: string },
): Omit<TemplateBriefGuidance, "note"> {
  switch (category) {
    case "listing":
      return {
        fieldLabel: "Listing details",
        helperText: "Include address or suburb, property type, key feature, price guide or inspection time, and the offer.",
        placeholder: `${sample.address}, ${sample.suburb}; ${sample.property}; lead with the strongest feature and add price guide or inspection time if relevant.`,
      };
    case "appraisal":
      return {
        fieldLabel: "Appraisal offer details",
        helperText: "Include suburb or street, who the ad is for, the appraisal or value offer, and one proof point.",
        placeholder: `${sample.suburb} homeowners; free appraisal offer; mention recent nearby demand and a simple value-update CTA.`,
      };
    case "market":
      return {
        fieldLabel: "Market update details",
        helperText: "Include suburb, reporting period, one market stat or buyer-demand point, and the report or consultation offer.",
        placeholder: `${sample.suburb} market update; ${sample.result}; include median value, buyer demand, or growth stat and offer a local report.`,
      };
    case "open_home":
      return {
        fieldLabel: "Open home details",
        helperText: "Include address, suburb, property type, inspection day and time, and the main reason to attend.",
        placeholder: `${sample.address}, ${sample.suburb}; ${sample.property}; open ${sample.result}; lead with the best feature.`,
      };
    case "sold":
      return {
        fieldLabel: "Result details",
        helperText: "Include address or suburb, sale result or social proof, buyer demand, and the next step for nearby owners.",
        placeholder: `${sample.address}, ${sample.suburb}; ${sample.result}; mention buyer demand and invite nearby owners to ask for an updated value.`,
      };
    case "general":
      return {
        fieldLabel: "Campaign details",
        helperText: "Include the audience, local context, offer, and one specific detail the ad should lead with.",
        placeholder: `${sample.suburb}; ${sample.property}; explain the offer and the main point the ad should make.`,
      };
  }
}
