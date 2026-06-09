# Blockwise — Real-Estate Ad Template Library

A searchable library of **45 copy + image templates**, reverse-engineered from the **~2,800 real ads** in your `research` database, plus the live dashboard and the overnight job to keep it fresh. Only winners go in.

## What's in this folder

| File | What it is |
| --- | --- |
| `Blockwise-Ad-Template-Library.xlsx` | The library. 45 templates, filterable (AutoFilter) by angle, audience, format, hook, funnel, goal. Tabs: Start here · Templates · Image briefs · Filter values. |
| `ad-template-studio.html` | Standalone copy of the live dashboard (also pinned as a Cowork artifact). Search templates + the real winning ads behind them; "Refresh from live DB" pulls the latest. |
| `images/` | 5 rendered hero creatives + a contact sheet, demonstrating the image templates. |
| `hermes-job/` | How to make this self-maintaining: overnight design doc, additive SQL (review-only), and a trigger.dev task skeleton. |

## How "the good stuff" is defined (the quality gate)

Templates are mined **only** from ads that pass two layers:

**Objective signals** — longevity (days running; 209 ads run 180+ days), still-active, creative iteration (advertisers refresh creatives they're spending on; up to 14 versions), and cross-agency adoption (e.g. **52** different advertisers run appraisal ads, **75** run agency-brand, **107** run listings — proven, not one-offs).

**AI review** — each ad is scored against AdStudio's own 6-point rubric (`scoring.ts`: offer clarity, local relevance, lead intent, brand fit, compliance safety, visual hierarchy) and a **market-relevance gate**. The gate matters: a pure-longevity ranking surfaces 24 overseas "Costa del Sol" foreign-language ads that run 400+ days but are useless to AU agents — they're excluded here and by the job.

## Variety (everything is a filterable facet)

- **14 angles:** Home Value/Appraisal, Market Update/Report, Buyer Demand, Just Sold, Just Listed, New Development/Off-the-Plan, Open Home, Auction, Property Management/Landlord, Investor/Co-living, Agency Brand/Agent Intro, Testimonial, Lead Magnet/Guide, Downsizer.
- **8 audiences:** sellers, passive owners, buyers, first-home buyers, investors, landlords, tenants, downsizers.
- **3 formats:** single image, carousel, video.
- **8 hook styles:** curiosity, data/stat, social proof, urgency, authority, FOMO, free-value, story.
- **3 funnel stages:** TOFU / MOFU / BOFU.

Every template carries real `{{variables}}` (suburb, agent_name, price, beds…) and maps to an AdStudio `offer_id` + `goal`, so it drops straight into a campaign.

## A few patterns the data proved win

- **The suburb report** ("[FREE] {{suburb}} Report — prices up {{growth}}%") is the single longest-running winner — Vivian's Mosman Park report has run **856 days**. Market-update ads have the highest average longevity.
- **"How much is your home worth?"** is the most-repeated hook across advertisers; the free price-update / appraisal angle is the workhorse.
- **Hands-off property management** ("Income, not hassle — Attention landlords") runs **1,103 days**.
- **Suburb-personalised stat ads** (Renouf's "Curious what your home is worth? — {{suburb}}: {{x}}% growth, {{n}} active buyers") are run verbatim across many suburbs — the most reusable structure in the set.

## How to use it

1. **Browse / filter** in the spreadsheet or the dashboard. Copy the headline + primary text, fill the `{{slots}}`, pair with the named image brief.
2. **Render images** — give the image brief's `ai_prompt_seed` to your AI image model, or hand the brief to a designer. The 5 examples in `images/` show the style. AdStudio can render production versions with the brand kit + property photo.
3. **Refresh** — click "Refresh from live DB" in the dashboard for the latest winners, or wire the overnight job (`hermes-job/`) to regenerate the whole library automatically.

## Compliance

All templates are tagged with Meta **Special Ad Category: Housing** requirements (no age/gender/postcode-radius targeting, no discriminatory language, no guaranteed-price claims, privacy-policy URL on lead forms). Review before publishing.

---
*Generated from `research.observed_ads` / `ad_creatives` (classifier-v2). Source data is competitor ads collected for research; treat copy as inspiration, not for verbatim reuse.*
