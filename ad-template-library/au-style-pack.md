# Australian Style Pack — make generated creatives look authentically AU

This is the drop-in content that makes AdStudio output look Australian instead of generic US suburbia. Three parts: (1) the governed image-prompt blocks to wire in, (2) an AU scene library, (3) AU copy rules. The 14 image briefs and the hero samples in this folder already use these cues.

Your image pipeline: `generate-image` → `assembleImagePrompt` composes the governed bundle (`adstudio.image.system` + `brand_rules` + `negative_prompt`) → `gpt-image-2` or `gemini-3.1-flash-image`, with brand-kit palette + reference photos. Today none of those prompts mention Australia, so the model defaults to American homes. The `prompt_versions` store is empty, so the live prompts are the **code defaults** in `src/lib/operator/prompts/prompt-registry.ts`.

---

## 1) Governed prompt blocks (wire these in)

Replace the three defaults with the AU-augmented versions below — either as a new **active version** in `prompt_versions` (governed path, no deploy; see `au-prompt-version-seed.sql`) or by editing the code defaults.

### `adstudio.image.system`  (current + AU)
> Create customer-facing real-estate ad imagery prompts. Follow brand and compliance constraints before customer input. Generate background and style instructions only; do not ask the image model to render final ad text, prices, claims, or guarantees.
>
> **All imagery is for the Australian residential real-estate market.** Depict authentically Australian homes, streets, gardens and skies appropriate to the named suburb and state. Use natural, bright Australian daylight with a clear blue sky. Photoreal, editorial real-estate quality. Compose with clean copy-safe space (the renderer overlays the text). Never depict American houses, signage, mailboxes, flags or seasons.

### `adstudio.image.brand_rules`  (current + AU scene rules)
> Brand image rules:
> - Use the approved palette and visual treatment as constraints.
> - Keep the image suitable for real-estate lead generation.
> - Avoid logos or final ad text inside the generated image unless a provided reference asset already contains brand marks.
> - Prefer natural light, clean composition, and space for ad copy overlays.
>
> Australian scene rules:
> - **Homes:** brick-veneer, weatherboard, rendered or Federation/Queenslander styles with **Colorbond steel** or tiled roofs, eaves, verandahs/alfresco. Match the region (see scene library).
> - **Setting:** native + established gardens (gum/eucalypt street trees, grasses, agapanthus), brick letterbox, harsh bright sun with deep shadows, clear blue sky. Cars on the **left** of the road.
> - **Signage:** agency-style "For Sale" / "Sold" boards in brand colours — never US realtor yard signs.
> - Prefer real supplied property/suburb photos as reference assets over fully synthetic homes.

### `adstudio.image.negative_prompt`  (current + AU anti-cues)
> Avoid: rendered text, distorted typography, misleading luxury claims, demographic targeting cues, before/after sale guarantees, cluttered compositions, low-resolution artifacts, warped buildings, distorted people, extra fingers, fake logos.
>
> Also avoid (non-Australian cues): US-style mailboxes on posts, American realtor yard signs, US/foreign flags, white picket-fence Americana, HOA-style manicured lawns, autumn foliage or snow (unless alpine AU), Mediterranean/Spanish villas, Californian palm-lined streets (unless tropical QLD), left-hand-drive US street scenes, $ shown as USD.

---

## 2) AU scene library (pick by region/climate)

- **Temperate metro** (Melbourne, Sydney, Adelaide, Perth, Hobart): brick-veneer & weatherboard, Victorian/Federation terraces, Californian bungalows, Colorbond or terracotta-tile roofs, established leafy gardens.
- **Subtropical / QLD**: Queenslanders (raised timber, wrap-around verandah, corrugated tin roof, stumps), tropical planting, ceiling fans, louvres.
- **Coastal** (Gold/Sunshine Coast, Northern Beaches, Perth coast): Hamptons & coastal-contemporary, rendered white/grey, big glazing, decks, dune grass, beach nearby.
- **New estates / off-the-plan**: modern render + feature-brick facades, double garage, alfresco, fresh turf, render at dusk (mark "artist impression").
- **Regional / rural**: acreage, Colorbond sheds, post-and-rail fences, gum paddocks, big sky.

Universal cues: Colorbond roofs, eaves & verandahs, native/exotic mixed gardens, eucalypt street trees, Hills hoist in backyards, harsh midday sun, clear blue sky, AU plates (blurred), cars on the left.

---

## 3) AU copy rules (spelling + terms)

**Spelling:** colour, favourite, neighbourhood, realise, organise, customise, maximise, recognise, centre, metre, licence (noun) / license (verb), enrol, programme→program (program is fine).

**Terms:** appraisal / market appraisal (not "valuation" or "CMA"); auction & private treaty; vendor; settlement; off the plan; strata / Torrens title; body corporate; "Offers above", "Under offer", "Under contract", "SOLD", "For Lease", "Now Leasing"; "Home Open" (WA) / "Open for Inspection" (eastern states).

**Bodies & portals:** REIWA (WA), REINSW/REIV/REIQ/REISA; realestate.com.au & Domain (not Zillow/Realtor.com).

**Format:** prices `$650,000` (AUD, no cents, no "USD"); phone `0412 345 678` or `(08) 9123 4567`; dates `Sat 21 June`; include the agency/agent **licence number** in the footer.

---

## 4) Getting it working (highest quality)

1. **Reference photos first.** Pass the real listing/suburb/brand-kit images as `referenceAssets` — `gpt-image-2` and `gemini-3.1-flash-image` both accept image refs. Real local photos beat any prompt and are the #1 authenticity lever. Use AI for backgrounds/cleanup (`regenerate-background`) rather than inventing whole homes.
2. **Wire the prompt blocks** above (governed version — see the seed SQL).
3. **Model + quality:** highest quality tier; correct aspect (1:1 / 4:5 / 9:16); keep text *out* of the AI image and let the renderer composite crisp overlay text.
4. **Per-template seeds** are already AU in this library (build view → image direction). 
5. **AU copy check** at the copy step (spelling + terms list above) before publish.
