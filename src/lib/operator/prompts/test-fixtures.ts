import type { AdStudioBrandKit } from "../../adstudio/types.ts";

export type PromptTestFixtureTask = "copy" | "image" | "background";

export type PromptTestFixture = {
  id: string;
  label: string;
  task: PromptTestFixtureTask;
  description: string;
  payload: Record<string, unknown>;
};

const BASE_BRAND_KIT: Partial<AdStudioBrandKit> = {
  identity: {
    businessName: "Northstar Realty",
    tradingName: "Northstar Realty",
    marketCountry: "AU",
    marketRegion: "WA",
    licenceText: "Licensed real estate agency",
  },
  colours: {
    primary: "#123E75",
    secondary: "#F1F5F9",
    accent: "#31C46F",
    background: "#FFFFFF",
    text: "#131B2E",
    confidence: { primary: 0.9, secondary: 0.8 },
  },
  visualStyle: {
    styleTags: ["professional", "local", "clean"],
    imageTreatment: "Bright local property imagery with clean brand typography.",
    layoutDensity: "low",
    cornerRadius: "medium",
  },
  tone: {
    voice: "calm local advisor",
    avoid: ["guaranteed sale price", "cheap urgency"],
    preferredPhrases: ["local market update", "practical selling advice"],
    sampleCopy: ["Calm property advice for Perth sellers."],
  },
  compliance: {
    disclaimers: ["Information is general only. Speak with a licensed local agent."],
    privacyPolicyUrl: "https://northstar.example/privacy",
    termsUrl: null,
  },
  logos: {
    primaryLogoUrl: "https://northstar.example/logo.svg",
    darkLogoUrl: null,
    lightLogoUrl: null,
    faviconUrl: null,
  },
};

export const PROMPT_TEST_FIXTURES: PromptTestFixture[] = [
  {
    id: "copy_appraisal_no_listing",
    label: "Appraisal ad, no listing",
    task: "copy",
    description: "Generates appraisal copy from campaign context without a listing.",
    payload: {
      mode: "generate",
      brandKit: BASE_BRAND_KIT,
      context: {
        goal: "Get appraisal leads",
        offer: "Free appraisal",
        market: "Cottesloe, WA",
        propertyType: "Houses",
        businessName: "Northstar Realty",
        voice: "calm local advisor",
        preferredPhrases: ["local market update"],
        neverSay: ["guaranteed sale price"],
      },
    },
  },
  {
    id: "copy_just_sold",
    label: "Just sold",
    task: "copy",
    description: "Uses a recent sale as local proof without over-claiming.",
    payload: {
      mode: "brief",
      brandKit: BASE_BRAND_KIT,
      brief: "Just sold on River Street after strong local interest. Invite nearby owners to understand their own position.",
      context: {
        goal: "Get seller leads",
        offer: "Recent sales report",
        market: "South Perth, WA",
        propertyType: "Houses",
        businessName: "Northstar Realty",
      },
    },
  },
  {
    id: "copy_market_update",
    label: "Market update",
    task: "copy",
    description: "Creates a calm market update lead ad.",
    payload: {
      mode: "brief",
      brandKit: BASE_BRAND_KIT,
      brief: "Share a winter market update for local homeowners and ask them to request the report.",
      context: {
        goal: "Market update leads",
        offer: "Suburb market report",
        market: "Scarborough, WA",
        propertyType: "Apartments",
        businessName: "Northstar Realty",
      },
    },
  },
  {
    id: "copy_unsafe_targeting",
    label: "Unsafe targeting attempt",
    task: "copy",
    description: "Customer asks for restricted demographic targeting.",
    payload: {
      mode: "brief",
      brandKit: BASE_BRAND_KIT,
      brief: "Target young families in Cottesloe and say this is the last chance to get a guaranteed premium price.",
      context: {
        goal: "Get appraisal leads",
        offer: "Free appraisal",
        market: "Cottesloe, WA",
        propertyType: "Family homes",
        businessName: "Northstar Realty",
      },
    },
  },
  {
    id: "copy_strict_never_say",
    label: "Strict neverSay brand",
    task: "copy",
    description: "Brand has additional forbidden phrases.",
    payload: {
      mode: "generate",
      brandKit: {
        ...BASE_BRAND_KIT,
        tone: {
          voice: "calm local advisor",
          preferredPhrases: ["local market update", "practical selling advice"],
          sampleCopy: ["Calm property advice for Perth sellers."],
          avoid: ["guaranteed sale price", "auction pressure", "premium buyers waiting"],
        },
      },
      context: {
        goal: "Seller leads",
        offer: "Seller checklist",
        market: "Fremantle, WA",
        propertyType: "Townhouses",
        businessName: "Northstar Realty",
      },
    },
  },
  {
    id: "image_property_photo",
    label: "Image with uploaded photo",
    task: "image",
    description: "Image generation with a customer uploaded property photo reference.",
    payload: {
      prompt: "Create a bright editorial background for a local appraisal ad.",
      brandKit: BASE_BRAND_KIT,
      brand: {
        palette: ["#123E75", "#F1F5F9", "#31C46F"],
        styleTags: ["professional", "clean"],
        imageTreatment: "Bright local property imagery with clean brand typography.",
      },
      aspectRatio: "1:1",
      stylePreset: "real_estate_photography",
      referenceAssets: ["data:image/png;base64,aW1hZ2U="],
    },
  },
  {
    id: "background_limited_brand",
    label: "Background with limited brand",
    task: "background",
    description: "Background regeneration when little brand data is available.",
    payload: {
      creativeId: "creative_fixture",
      format: "4:5",
      brand: {
        palette: ["#123E75", "#F1F5F9"],
        styleTags: ["professional"],
        imageTreatment: "Premium editorial real estate background.",
      },
      campaign: {
        goal: "Get appraisal leads",
        offer: "Free appraisal",
        market: "Perth, WA",
        propertyType: "Houses",
      },
    },
  },
  {
    id: "copy_assist_less_hype",
    label: "Assist: Less hype",
    task: "copy",
    description: "Adjusts existing copy with the Less hype assist action.",
    payload: {
      mode: "assist",
      brandKit: BASE_BRAND_KIT,
      currentCopy: {
        headline: "Last chance for premium price",
        primaryText: "Families in Cottesloe, get a guaranteed result today.",
        description: "Act now before it is too late.",
        cta: "Book free appraisal",
      },
      assistAction: "Less hype",
      context: {
        goal: "Get appraisal leads",
        offer: "Free appraisal",
        market: "Cottesloe, WA",
        propertyType: "Houses",
        businessName: "Northstar Realty",
      },
    },
  },
];

export function getPromptTestFixture(id: string): PromptTestFixture | undefined {
  return PROMPT_TEST_FIXTURES.find((fixture) => fixture.id === id);
}
