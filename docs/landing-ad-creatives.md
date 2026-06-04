# Landing Page Ad Creatives — Research → Fake Ads

Goal: replace the CSS `scene-1…6` placeholder boxes in `src/app/page.tsx` with real,
photoreal ad creative images, modelled on the **longest-running, proven** real-estate
lead-gen ad formats (the ones agents leave running for months because they keep
converting).

## What the research says wins (evergreen formats)

The ad formats that run longest in the Meta Ad Library for real-estate agents are the
low-commitment, hyperlocal, social-proof plays — not one-off listing blasts:

1. **"What's your home worth?" / free valuation** — the #1 evergreen *seller-lead* ad.
   A high-value, low-commitment offer homeowners can't resist. Local stat + scarcity +
   free no-obligation valuation. Documented at **<$6 / seller lead**.
2. **Just Listed / Just Sold** — social proof, hyperlocal ("sold above reserve in your
   street"). Builds trust at the first touch.
3. **Off-market / coming soon** — exclusivity and curiosity; pulls both buyers and seller
   leads who want the "quiet" sale.
4. **Auction / event with urgency** — registered bidders, inspection times, a deadline.

Creative rules that correlate with long run-time and CTR:
- One **attractive exterior hero shot** of a home that matches the target market.
- Subtle **lifestyle** cues (warm light, lived-in, aspirational but real).
- Bold **status + price badge** overlaid (Just listed / Off-market / Auction Sat; $1.4M).
- **Local pin** (suburb) for hyperlocal trust.
- One clear **CTA** ("Book appraisal" / "Get my home value").
- Single image CTR is lower than carousels, so the single hero must be strong — real
  photography style beats illustration.

## The four fake ads (mapped to the existing landing slots)

Each keeps the fictional Perth agency already on the page and assigns it a proven format.
Image filenames are what the wiring step will reference in `/public/ads/`.

### 1 — Northstar Realty · Mount Lawley · Facebook feed (`ad-northstar.jpg`)
- **Format:** Just Listed + valuation hook (seller lead)
- **Copy:** "Mt Lawley owners — three homes like yours sold above reserve this month. Free 15-min appraisal."
- **Badge / price:** "Just listed" · "$1.4M" · pin "Mount Lawley"
- **CTA:** Book appraisal
- **Image prompt:**
  > Photoreal real-estate listing photo of a restored 1920s Federation brick-and-tuckpointing
  > home on a leafy inner-Perth street, deep verandah, established frangipani and jacaranda,
  > warm late-afternoon golden-hour light, shot on 24mm, professional property photography,
  > crisp, inviting, no people, no text. 4:5 portrait.

### 2 — Coastline Property · Cottesloe · Instagram story (`ad-coastline.jpg`)
- **Format:** Off-market / exclusivity (buyer + seller curiosity)
- **Copy:** Headline "Ocean glimpse. 4 bed, 2 bath." · "Off-market" · "Guide $2.8M"
- **CTA:** Swipe up
- **Image prompt:**
  > Photoreal architectural photo of a contemporary white rendered coastal home in Cottesloe
  > WA, large glazing, limestone wall, a sliver of Indian Ocean visible past the rooftops at
  > dusk, soft blue hour with warm interior lights glowing, professional real-estate
  > photography, vertical composition with clean sky for text overlay, no people, no text.
  > 9:16 vertical.

### 3 — Hill & Co. · South Perth · Facebook feed (`ad-hillco.jpg`)
- **Format:** Auction urgency (event + deadline)
- **Copy:** "Saturday auction, 1pm. Three bidders registered. Inspections Thursday 5:30pm."
- **Badge / price:** "Auction Sat" · "$2.1M+" · pin "South Perth"
- **CTA:** Book appraisal
- **Image prompt:**
  > Photoreal real-estate photo of a wide-block riverside terrace home in South Perth, render
  > and timber facade, manicured front garden, the Perth city skyline faintly across the
  > Swan River in the background, bright clear morning, professional property photography,
  > no people, no text. 4:5 portrait.

### 4 — Hillview Agents · Subiaco · Instagram story (`ad-hillview.jpg`)
- **Format:** New listing / lifestyle walkability
- **Copy:** Headline "Subi cottage. Walk to Rokeby Rd." · "New listing" · "Guide $1.6M"
- **CTA:** Swipe up
- **Image prompt:**
  > Photoreal photo of a charming restored Victorian workers' cottage in Subiaco WA, painted
  > weatherboard and iron-lace verandah, picket fence, leafy character street, soft morning
  > light, aspirational but real, professional real-estate photography, vertical composition,
  > no people, no text. 9:16 vertical.

## Generation settings
- Model: `gpt-image-1` (already wired in `src/lib/adstudio/ai-providers.ts`).
- Quality: high. Sizes: FB feed 1024×1280 (4:5), IG story 1024×1536 (9:16).
- All text/badges/price stay as the existing HTML/CSS overlay — the AI image is the clean
  background only (prompts say "no text" so overlays stay legible).
