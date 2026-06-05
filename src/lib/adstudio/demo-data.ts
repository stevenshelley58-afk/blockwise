import {
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  listOfferTemplates,
} from "./index.ts";

// Richer HTML so brand extraction picks up all required fields without guessing.
const NORTHSTAR_HTML = `
  <html>
    <head>
      <title>Northstar Realty | Perth Real Estate Agents</title>
      <meta name="description" content="Award-winning local real estate agents in Perth and the western suburbs. Northstar Realty helps WA homeowners sell with confidence.">
      <meta property="og:site_name" content="Northstar Realty">
      <link rel="icon" href="/favicon.ico">
      <style>
        :root { --brand: #087f7a; --ink: #18201f; }
        body { font-family: Inter, sans-serif; color: #18201f; }
        .button { background: #087f7a; border-radius: 8px; color: #fff; }
        .badge { color: #087f7a; }
      </style>
    </head>
    <body>
      <header>
        <img src="/logo.svg" alt="Northstar Realty logo">
        <nav>
          <a href="https://northstar.example/sell">Sell</a>
          <a href="https://northstar.example/buy">Buy</a>
          <a href="https://northstar.example/about">About</a>
          <a href="https://northstar.example/contact">Contact</a>
        </nav>
        <a href="tel:0892340001">(08) 9234 0001</a>
        <a href="mailto:hello@northstar.example">hello@northstar.example</a>
      </header>
      <main>
        <h1>Experienced Perth real estate agents you can trust</h1>
        <p>Northstar Realty has helped over 400 Perth families sell their homes. Our team covers Scarborough, Karrinyup, Trigg, and the broader northern suburbs.</p>
        <p class="badge">Licensed Agent - Reiwa member - 4.9 stars from client reviews</p>
        <a class="button" href="https://northstar.example/seller-checklist">Get your free seller checklist</a>
        <section>
          <h2>Planning to sell in 2025?</h2>
          <p>Download our free pre-sale checklist — used by over 400 Perth sellers. Cover photos, opens, pricing, and what not to spend money on.</p>
          <a class="button" href="https://northstar.example/seller-checklist">Download checklist</a>
        </section>
      </main>
      <footer>
        <p>Information is general only and does not constitute legal or financial advice. Speak with a licensed local agent for property-specific guidance.</p>
        <a href="https://northstar.example/privacy">Privacy policy</a>
        <a href="https://northstar.example/terms">Terms of use</a>
      </footer>
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
    platforms: ["meta"],
    variantCount: 5,
  });

  // Patch the first variant's copy pack with polished sample copy that reads
  // like a live campaign rather than a placeholder.
  const patchedCopyPacks = pack.copyPacks.map((copyPack, index) => {
    if (index !== 0) return copyPack;
    return {
      ...copyPack,
      meta: {
        ...copyPack.meta,
        primaryText: [
          "Thinking of selling in Scarborough? Download the free pre-sale checklist used by 400+ Perth sellers — covers photos, opens, pricing, and what not to spend money on.",
        ],
        headlines: [
          "Free Scarborough Seller Checklist",
          "Plan your sale before photos",
          "400+ Perth sellers can't be wrong",
        ],
        descriptions: ["Practical prep guide for Perth homeowners."],
        cta: "LEARN_MORE" as const,
      },
      googleSearch: {
        ...copyPack.googleSearch,
        headlines: [
          "Free Seller Checklist",
          "Selling in Scarborough?",
          "Pre-sale Prep Guide",
          "Perth Home Sale Tips",
          "Get Ready to List",
          "Local Seller Guide",
        ],
        descriptions: [
          "Download the free checklist before photos, opens, or pricing talks.",
          "Used by 400+ Perth sellers. Plan your campaign with confidence.",
          "Northstar Realty | Scarborough's trusted local agents.",
        ],
      },
    };
  });

  return {
    brandKit,
    campaignPack: {
      ...pack,
      campaign: { ...pack.campaign, name: `Sample: ${pack.campaign.name}` },
      copyPacks: patchedCopyPacks,
    },
    offers: listOfferTemplates(),
    performance: {
      leads: 43,
      costPerLeadAud: 22,
      bookedAppraisals: 6,
      bestFormat: "4:5",
      recommendations: [
        "Use stronger problem hooks in primary text",
        "Keep the checklist offer — it outperforms free-appraisal CTA 2:1",
        "Test local social proof (review count) in the next variant set",
      ],
    },
  };
}
