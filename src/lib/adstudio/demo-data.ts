import {
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  listOfferTemplates,
} from "./index.ts";

const NORTHSTAR_HTML = `
  <html>
    <head>
      <title>Northstar Realty</title>
      <meta property="og:site_name" content="Northstar Realty">
      <link rel="icon" href="/favicon.ico">
      <style>
        :root { --brand: #087f7a; --ink: #18201f; }
        body { font-family: Inter, sans-serif; color: #18201f; }
        .button { background: #087f7a; border-radius: 8px; }
      </style>
    </head>
    <body>
      <header>
        <img src="/logo.svg" alt="Northstar Realty logo">
        <a href="tel:0899990000">(08) 9999 0000</a>
        <a href="mailto:hello@northstar.example">hello@northstar.example</a>
      </header>
      <main>
        <h1>Calm local property advice for Perth sellers</h1>
        <p>Information is general only. Speak with a licensed local agent for property-specific advice.</p>
      </main>
    </body>
  </html>
`;

export function getAdStudioDemoBundle() {
  const brandKit = {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_demo",
      websiteUrl: "https://northstar.example",
      marketCountry: "AU",
      marketRegion: "WA",
      htmlByUrl: {
        "https://northstar.example": NORTHSTAR_HTML,
      },
    }),
    reviewStatus: "approved" as const,
    lockedFields: ["identity.businessName", "colours.primary"],
  };
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit,
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
    variantCount: 5,
  });

  return {
    brandKit,
    campaignPack: pack,
    offers: listOfferTemplates(),
    performance: {
      leads: 126,
      costPerLeadAud: 18,
      bookedAppraisals: 14,
      bestFormat: "4:5",
      recommendations: [
        "Use stronger problem hooks",
        "Keep checklist offer",
        "Test local proof in the next variant set",
      ],
    },
  };
}
