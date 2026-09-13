# DESIGN.md

Generated from the rules review on 2026-09-11. 41 rules, consolidated from 28 source documents.

## Contract and precedence

- **This document is the design contract.** This is the binding design contract for the Blockwise customer surface. It defines the visual system, the component vocabulary, and the design rules an agent must follow. Change it in the same commit as the design decision it records.
- **Owner preferences are current authority.** The owner preferences section below is the current authority wherever older guidance in this file conflicts with it. They refine the system; they never authorise a parallel visual language or the removal of useful capability.
- **Frank keeps its own design contract.** Frank's Window design contract lives at /projects/frank/apps/window/DESIGN.md and is not repeated here. This file covers the customer product surface only.
- **Design detail moves to reference files.** Keep this file to binding rules and the token and component vocabulary. Move worked examples, route inventories and screenshots to docs/design/ and link them.

## Intent and register

- **The Quiet Operations Desk.** Blockwise is a work-focused product used while a real-estate team prepares, checks or improves live advertising. The interface should feel like a calm operations desk: the next action is obvious, system state is legible, and visual craft supports the work without competing with it.
- **Premium v2 is the current register.** Premium v2 keeps the near-black one-voice accent, neutral surfaces, Manrope/Inter type, compact radius scale and operational density, and adds exactly three things: one vivid configurable data hue for quantitative display, a spring motion system, and complete loading, empty and success states. It is not a redesign.
- **One visual language.** The customer surface consumes one token and component vocabulary. A surface may be purpose-built, but it may not introduce a new accent family, radius scale, typography system or navigation grammar.
- **Design for the distracted phone user first.** Review a new screen as a distracted one-handed mobile user first, then as a desktop operator. Preserve approved sections and safety controls while removing repetition.

## Owner preferences

- **No decorative eyebrows.** Do not place an eyebrow above a page heading or use one as filler. The eyebrow token remains for legacy surfaces and dense technical metadata only.
- **Use fewer words.** Keep labels, required instructions, prices, terms, validation, status and accessibility text. Remove copy that only explains an obvious image, heading, card or control.
- **Make the screen self-explanatory through hierarchy.** Improve the headline, preview, grouping or next action. Never add explainer text to compensate for weak hierarchy.
- **Keep the palette and simple typography.** Use the existing shadcn/Tailwind bridge, Manrope/Inter type, neutral surfaces, ink action colour and shared radii before adding anything route-specific.
- **Prefer rounded surfaces.** Avoid square cards, sharp image containers and page-local radius systems. Reuse --r-ctl, --r-card, --r-panel and the pill radius.
- **Limit scrolling, not information.** A shorter screen must not come from tiny text, clipped content, hidden controls or invented omissions. Keep long forms, reports and lists when the task needs them; collapse repetition and completed setup.
- **Make mobile feel like an app.** Use the existing bottom navigation, safe areas, sheets, reachable actions, stable previews and clear Back behaviour. Do not stack a desktop page into a phone.
- **Keep customer navigation permanent.** Self-serve customer routes keep the five mobile destinations: Home, Ads, Results, Leads and More. Ads owns the full Ad Studio subtree. Never expose an unavailable tool or invent a destination to fill the menu.
- **Keep mobile layers deliberate.** Fixed navigation and visible consent reserve layout space. Sheets sit above navigation, consent yields while a modal is open and returns afterwards. Never cover controls or the device safe area.
- **Email uses the Quiet card.** Email surfaces reuse the established surface, border, radius and typography tokens in both light and dark themes, with the message and one clear action primary.
- **Show the product clearly.** Ads, Feed and Story previews, charts and editable content stay readable at phone widths. Never use a tiny desktop screenshot as a substitute for a mobile composition.
- **Motion explains state.** Use brief, smooth, purposeful transitions for selection, progress, saved state, confirmation and spatial continuity. Do not delay routine work with choreography. Working customer screens do not use ambient loops; a marketing preview may loop when the loop itself demonstrates the product output.
- **Use truthful states.** Never infer verification, connection, payment, freshness, current metrics or completion from the presence of a record alone. State what is known, what is pending, and the next safe action.
- **Keep one obvious next action.** Secondary capabilities stay available but never compete equally with the current task.
- **Keep trial language direct.** Use Start your free trial and No card required where appropriate. Show the actual allowance, renewal, charge, cancellation and ad-spend terms beside the decision that needs them.

## Tokens

- **One token source.** The bridge in src/app/tailwind.css is the single source of truth. shadcn semantic tokens resolve to the Blockwise values in this document, so a token change here propagates. Never hardcode a value a token already provides.
- **Never hardcode a chart colour.** The data hue (--ui-data*) is overridden per niche from src/config/niche in the customer layout. Never hardcode a chart colour in a component.
- **Customer pages contain zero niche nouns.** All surface copy flows from src/config/niche so the same shell white-labels.
- **Data Blue is the one vivid voice.** The data hue is used only for quantitative display: charts, meters, sparklines and gauge fills. It never becomes a general accent for buttons, links, navigation or decoration.
- **Every line is a smooth curve.** A series is drawn as a monotone cubic, never as straight segments between points: the figure cards' lines, the reporting charts and the marketing previews that show the product, on desktop and mobile alike. Monotone is the honest choice as well as the smooth one, because the curve never overshoots a value the period recorded. Hand-drawn SVG builds it with `src/lib/charts/smooth-line.ts`; a recharts series states `type="monotone"`. A new chart that draws straight segments is a regression, not a style.

## Motion

- **Motion timings have one source.** src/lib/motion.ts is the single source of truth. Pages and components import from there and never define their own timings.
- **The motion vocabulary.** Springs: snappy for micro-interactions, gentle for entrances, slow for progress bars and meters. Durations: micro 150ms, state 250ms, entrance 350ms. Nothing on the customer surface moves slower than entrance.
- **Entrance and count-up.** Entrance is a 12px rise and fade, staggered 40ms between siblings, once per navigation. KPI numbers count up over 900ms. Both swap to their final state under reduced motion.
- **Reduced motion is mandatory.** Every transform is gated: useReducedMotion for motion/react, the motion-reduce variant for CSS. There is exactly one confetti moment, the first-run handoff into Ad Studio; it is brief, never loops, and is skipped entirely under reduced motion.
- **Hover lift is reserved.** Hover lift applies only to genuinely interactive cards.

## States

- **Every data surface ships four states.** A surface that can load, be empty, succeed or fail renders all four. No dead ends.
- **Nothing connected is not a dead end.** Performance opens the labelled example report with the Connect Meta action while the workspace has no Meta connection; it never parks the customer on an interstitial that only repeats that action.
- **Unavailable is not zero.** Show unavailable reporting as unavailable with a contextual recovery link. Never substitute zero for missing data.
- **No fabricated data in a card.** Every card renders an explicit ready, empty, attention, unavailable or error state and must not fabricate data.

## Components

- **Reuse the shared vocabulary.** src/components/ui/ is the shared vocabulary for buttons, cards, dialogs, sheets, tables, selects, inputs and navigation. Build from it before creating anything new.
- **Every button is the CTA.** One button exists on the customer surface: the Blockwise CTA in src/components/ui/button.tsx. A text button renders a full pill in ink with a circular disc on the trailing edge carrying an up-right arrow; the disc is the inverse of the pill (a cta-foreground circle with an ink arrow), sized `height − 6px` so a 3px ink ring is visible at every size. On the quiet variants the disc takes a soft ink wash, because a white disc on a near-white surface disappears. Icon-only controls render the pill with no disc. `arrow={null}` or `disc="none"` removes the disc for a control that is genuinely not a CTA, and `variant="link"` is never a pill.
- **The CTA variant ladder.** `default` is the ink pill with the disc and is the only primary action on a screen. `outline` is the same pill in surface white with a Control Line boundary, for the secondary action beside it. `ghost` and `ghost-pill` are quiet toolbar and page-head controls. `destructive` stays on the ink pill with error text. Never hand-roll a button, a pill-shaped link or a second primary action; `<Button asChild>` wraps a link and renders it as the same CTA.
- **CTA colour has one source.** `--ui-cta`, `--ui-cta-foreground` and `--ui-cta-soft` in src/app/tailwind.css bridge onto the ink accent, and theme-monochrome.css restates `--ui-cta` and `--ui-cta-soft` beside the `--accent` they follow. The disc colours are set on the button, never restated per call site.
- **CTA motion is contained.** On hover the disc's arrow turns 45 degrees to point up and the disc lifts a touch, both transform-only over 500ms, and both still under reduced motion. Nothing in the CTA changes the pill's width or height on hover or focus, so a row of actions cannot shift under the pointer.
- **The CTA survives the legacy sheets.** `audit.css` and `suburb-report.css` are unlayered, so their `.audit-page a` and `.sr-page button` element rules outrank every Tailwind utility. Their resets exclude the CTA's `bw-cta` marker class, which travels in `className` because that is the one prop every wrapper component forwards. A wrapper that renders its own element must forward the rest of its props, or the CTA loses the markers and padding the button merges onto it.
- **Every button is a real control.** The CTA renders a `<button>` with its own type, or the caller's link, and never a clickable `div`. Keep accessible names, `aria-pressed`, `aria-expanded` and disabled state on it.
- **Hierarchy before containers.** Use sections, rows, hairlines and disclosures before rounded cards or chart scaffolds. Keep Home flat by default, with one named exception: the weekly metrics row below.
- **The weekly metrics row is Home's only card row, and Results opens with the same one.** The four figures — spend, link clicks, cost per link click and leads — each render in the shared KPI card surface: `rounded-(--r-card)`, `border-(--line)`, `bg-card`, `shadow-card`, with that figure's sparkline and prior-period comparison inside its own card. Two cards across on a phone, one row of four from `lg`, because the sidebar takes its width before that. Leads, local ads and everything else on Home stay flat: sections, rows and hairlines. Results leads with the same four cards over the range it is showing and puts every other figure it reports inside More reporting details.
- **Every figure card draws its own period, or says why it cannot.** A figure's line comes from the days it could measure: a day with no clicks contributes no cost per link click to that line rather than dropping the period's shape, and fewer than two measured days draws nothing. The printed figure is that same set of days summed, so a card's number and its own line can never be two different stories, and the two surfaces that show the same week print the same week. A demo fixture whose figure never moves is a fixture that needs fixing, not a chart to fake.
- **One figure card, used everywhere.** That card is `src/components/ui/metric-card.tsx`: label, figure, its own line, its comparison, and the money and count formats both bands share. Home and Results both build their figure rows from it, so a surface never hand-rolls a second stat card. A figure with no daily series draws no line, and a missing figure renders the unavailable mark rather than a zero, with no comparison beside it.
- **One period control per surface, next to the data it slices.** Results states its range once, in the chart card above the line it changes; the heading keeps the title, the sync state and Refresh. Do not repeat the same period as chips or a second selector, and choose the chart's own metric from a menu rather than a row of buttons. That one control slices the whole page, the figure row included: the row's heading names the window the figures on screen actually cover — the payload's range, never the range a customer just picked while the fetch is still in flight — and the customer's own span says its dates rather than a label that would leave them guessing which dates it meant.
- **The chart menu offers the metrics a customer acts on, most important first.** Leads, then what they cost, then spend, then delivery and response, then the rates; "leads" is the product's word for them everywhere, never "enquiries". A figure with no daily series is not offered rather than charted as an empty axis, and a ratio that a day cannot divide leaves a gap in the line with one note saying why. The count of valid leads is not offered either: lead quality is audited in the tables that carry it, while the valid lead rate stays on the menu as the share of the leads on the chart that were worth having.
- **One notice bar, used everywhere.** That bar is `src/components/ui/notice-bar.tsx`: the amber preview marker, the note, and the product's own call to action. Home's weekly figures, Home's example leads and Results' example report all close on it with the same sentence, so a preview is labelled the same way wherever it appears.
- **A notice bar keeps its note and its action on one row at every width.** The action never drops to a line of its own: the note is the item that yields, sized from the space left beside the action and wrapping inside its own lane rather than being truncated. Never truncate a note to win the space. The bar carries the gap of the section flow it was built for; a surface that lays its own gaps out states that space itself.
- **A demo workspace sees example leads, and they say so.** A workspace with no delivery of its own gets example rows where its own leads would be, labelled by the same bar and the same sentence the demo figures close on, so the empty state is a preview of the work rather than a blank. They are the one section that carries the product's call to action instead of a link of its own, because there is nowhere to go yet. A workspace with real delivery and no leads keeps saying "No leads yet".
- **Leads are modelled on the CRM's records.** Blockwise's CRM is Frappe CRM: a lead is `CRM Lead` (lead name, territory, source, status, owner, Meta lead ids) and `source` and `status` are Link fields pointing at `CRM Lead Source` and `CRM Lead Status` records that a deployment names itself. A row prints the status record it is given rather than inventing a state, and falls back to waiting time only while no CRM state exists.
- **One label per fact.** State a caveat once, at the level it applies to. A band that is entirely demo data says so in its one note under the figures; it does not repeat the same word as a badge beside the heading. On a page where two blocks are both demo data, each block closes on that one note, in the same words, because each block is read on its own.
- **Ad Radar feeds Home's local ads, keyed on the workspace's own area.** Read the list for the postcode from the workspace's brand address, and fall back to the niche's default area until an address supplies one.
- **A URL is not a thumbnail.** The research archive holds cards whose archived object has gone missing, so a card is only offered a row once its still has answered a request; verify the candidates on the server, hold the verdict for an hour, and check more than Home shows so one dead image does not shorten the row. Never fill a row with a card that cannot draw its own still, and never hand a video file to an image element.
- **Home shows local ads two ways, and both are Ad Radar's.** On a phone they are rows: thumbnail, advertiser, headline, area. From `lg` they are the same ads as Ad Radar cards, four to a row, drawn by the shared tile rather than a Home-only copy of it.
- **Lead with the customer's real creative.** Home leads with the customer's creative and keeps its next action linked to a server-resolved, available route.
- **Guides are content-first.** Lead with the useful content, use rounded panels only when they improve grouping, and keep promotion subtle and secondary.
- **Help owns the walkthrough.** `/help` is the customer destination for provider walkthroughs, screenshots, tips and edge cases. A working screen keeps only the instruction its next action needs, plus one link to Help; it never carries the manual. The Meta sharing steps in `src/components/meta/partner-steps.ts` are the single source shared by `/connect-meta` and Help, so the checklist and the walkthrough cannot drift apart.
- **The customer never transcribes provider IDs.** A customer confirms what they shared in the provider's own screens; the operator reads the resulting asset IDs from the provider and records them. Never ask a customer to find and type an account, Page or pixel ID.
- **A connection row carries one action.** A provider row offers Connect while disconnected and Disconnect while connected, and nothing else. Never place a Save button, a second Reconnect control or a settings form beside the connection action on the same card.
- **Provider values are shown, not typed.** A value the provider owns (Meta ad-account currency and timezone, Meta asset IDs) renders read-only with a one-line note naming its source, and reads blank with a note about where it will come from until the provider is connected. Never pre-fill it with a default the provider would reject, and never let the customer edit it.
- **Asset choices save themselves.** A choice whose options come from the provider saves as it is picked, so there is no Save button to forget and no half-saved state. Workspace facts the customer owns keep an explicit Save.
- **A waiting state always has a way out.** A screen waiting on a person or an external check offers the customer the action that moves it forward, and never traps them behind a status they cannot change.

## Native ad editor

- **Vue Fabric Editor is an upstream interface, not a new Blockwise design system.** The owner chose its ready-made editing experience to avoid maintaining another custom editor. Keep its standard canvas controls and toolbar inside a same-origin, style-isolated frame. Do not rebuild those controls in React or reskin every upstream component.
- **The surrounding product remains Blockwise.** Entry, save status, template and AI copy, ad previews, errors and review/publish use the existing shared controls. The artwork leads; integrations are secondary panels rather than another permanent form.
- **Opening is non-destructive.** The native editor is the default. Reuse an idempotent native copy of an original ad, preserving its saved source. No trial footer or migration choice on the normal editing surface. The original renderer remains accessible only through an explicit legacy URL. Never open a native design in the old renderer.
- **The preview must show the edited artwork.** Feed and Story ad previews use the native editor's current exports, with the real template/brand text and native Meta CTA outside the artwork. Do not substitute the original template render after a free-form edit.

The native editor starts on the actual edited ad preview. Template headings wrap at words, not arbitrary letters. Initial text is fitted using its actual font, box, line limit and existing overflow policy; saved customer typography is never refitted on reopen. Photos, Words and Adjust design occupy a slim secondary left tool column on desktop, and one equal-width bottom row on mobile. These tool buttons use the shared arrow-free option, with visible icon-and-text labels; the main customer navigation stays separate. Review & publish is primary; Save and its truthful status remain available. Adjust design reveals the stock full-width native canvas, and Done designing returns to the ad. These are two views of one continuously mounted native editor, not two implementations or a conversion. Preserve all freeform edits on transition and keep hidden design tools keyboard-inert. Copy, optional AI help and photo choices use shared Sheets rather than permanent sidebars. Secondary copy settings are disclosed when needed. Feed and Story dimensions remain fixed; native file imports and cloud services are not exposed. Original ads and the old editor remain available. See docs/architecture/adstudio-vue-editor.md for alternatives and trade-offs.

## Publishing

- Publishing starts from saved lead-generation creative, not a required property workflow. The review surface keeps the exact saved preview prominent and uses Lead capture, Audience & budget, and Review.
- Generate leads is the recommended setup. Why use this campaign setup? and Customise setup are separate collapsed disclosures. Existing campaigns and ad sets are selected by provider name, never transcribed IDs.
- One Approve & publish action authorises safe creation followed by activation. No second activation confirmation. Provider-write gates still apply and preview/manual modes never claim a Meta submission.
- Budget scope sits immediately above approval. A daily budget is not a total or hard daily cap; inherited budgets are shared and unchanged, not a new per-ad allowance.
- Success offers View in Performance and Create another ad. Configured ACTIVE alone never means Live. Pending, review, scheduled, failed and unconfirmed provider states remain distinct.
- Keep management in Performance. This change does not add an Ads Manager navigation destination.

## Accessibility

- **Accessibility is part of done.** Controls keep accessible names and roles, focus is visible and ordered, and colour is never the only carrier of meaning. Accessibility text is functional copy and is never trimmed by the fewer-words rule.

## How to change this system

- **Changing the system.** A new accent family, radius scale, typography system or navigation grammar is a system change: it needs the owner's decision and a DESIGN.md change in the same commit. A purpose-built surface that reuses the existing vocabulary is not a system change.


---

## Changelog

- 2026-09-12: Results' chart menu says "Leads over time" rather than "Enquiries
  over time" — the product calls them leads everywhere — and the valid-lead count
  left the menu, leaving lead quality to the campaign and angle tables while the
  valid lead rate keeps its line. Home's chart empty state follows the same word.
- 2026-09-12: every line on the customer surface is now a monotone cubic, drawn
  by `src/lib/charts/smooth-line.ts` for hand-drawn SVG and by `type="monotone"`
  for a recharts series: the figure cards' lines stop reading as wires, and the
  marketing hero's preview chart follows the product. The one notice bar keeps
  its note and its action on one row at every width, the note wrapping in its own
  lane instead of pushing the way out onto a second line.

- 2026-09-12: a demo is labelled one way everywhere. The one notice bar says
  "Demo numbers for an example account" under Home's figures, under Home's
  example leads and now under Results' figures, which is where the demo
  statement belongs rather than above the numbers it labels. Results' example
  banner is retired with it: no chip, no hidden strip, no hide control, because
  the example leaves by itself once Meta is connected.
- 2026-09-12: Results now leads with Home's four figure cards — spend, link
  clicks, cost per link click and leads — under a heading naming the range on
  screen, and every other figure moved into More reporting details. The page
  opens on the trailing week, so the one range control slices the figures and the
  chart together, and both surface ranges are kept warm for connected
  workspaces. Rewrote three rules: the card row now belongs to Results too, a
  figure's printed number is the sum of the days its line is drawn from, and the
  row's heading follows the payload rather than the selector. The demo fixture's
  ad-level clicks now follow the ratio its daily series uses (they had drifted 4×,
  leaving the demo's click-through rate card disagreeing with its own chart), and
  the daily drift is keyed to the day's place in the month so the trailing week
  reads the same whether a surface asks for the week or the month.
- 2026-09-12: Home's notice bars keep the note and the action on one row, and
  the leads note shortens to "Example leads" so a phone can hold that row.
- 2026-09-12: the weekly band is titled "Last 7 days" (it no longer repeats the
  window twice), the local-ads heading is "Ads near you", the demo note's action
  wears the product's own call to action, and a demo workspace sees example leads
  shaped like Frappe CRM's `CRM Lead`.
- 2026-09-12: Home's local ads are now the ads Ad Radar shows, four to a row from
  `lg` and rows on a phone, and only ads whose archived still actually answers
  are listed at all.
- 2026-09-12: the weekly metrics row grew its fourth figure (leads), two up on a
  phone and one row on desktop; cost per link click now draws a line from the
  days that had clicks, and the demo fixture's cost per click moves day to day
  instead of sitting perfectly flat.
- 2026-09-12: one button on the customer surface. src/components/ui/button.tsx
  now renders the CTA itself: an ink pill with a trailing circular disc carrying
  the up-right arrow, added automatically to every text button and link CTA, and
  omitted for icon-only controls. Added `--ui-cta` / `--ui-cta-foreground` /
  `--ui-cta-soft` tokens and the `bw-cta` marker that exempts the CTA from the
  unlayered audit and suburb-report element resets, grew the size scale to `lg`
  48px / `default` 40px / `sm` 32px, and replaced the per-surface pills and the
  separate `ButtonArrow` markup.
- 2026-09-12: Home's weekly metrics moved into the shared KPI card surface, the
  duplicate demo badge beside the heading was removed in favour of the one note
  under the figures, and Home's local-ads list became Ad Radar results keyed on
  the workspace's own postcode.
- 2026-09-12: ad-account connection simplified. Added four rules: one action per
  connection row, provider values shown read-only with their source named, asset
  choices that save themselves, and a way out of every waiting state. The
  Workspace card now owns the privacy policy, lead destination and the mirrored
  currency and timezone.
- 2026-09-11: condensed to binding rules. Reference material, worked examples and
  route inventories moved out; token values, the motion vocabulary and the owner
  preferences kept verbatim from the previous version.
- 2026-09-12: Homepage workflow now uses a measured, finite Choose → Customise → Review sequence with one persistent ad preview and a concise setup check.

- 2026-09-12: Homepage workflow keeps one persistent ad through Choose, Customise and Review. Its finite marketing sequence uses the shared workflowStudy timings, holds the approval state long enough to read, and follows the study container rather than the browser viewport for its responsive geometry.


### Homepage workflow, September 13
The approved three-screen explainer uses one reversible Motion timeline for Choose, Customise, Review and approval, with a completion-gated writing phase, not independent entrance timers. Each selection captures the current visual frame and interpolates directly to its destination, so skipping a screen does not flash an unwanted intermediate screen. All layers remain mounted. Choose scrolls through three distinct photo creatives before selecting the persistent ad. Edit shrinks and fades out; Review grows from the same anchor before its details appear. The ad image and size stay unchanged between Customise and Review. Approval adds one 10px hop, synchronized with the green approval state and the Live badge on the photo; reduced motion shows the badge without the hop. The static ad link title is not an editing step. After the empty editor arrives, only Headline and Ad text type sequentially at 38ms per character, with 120ms between fields. Each character boundary updates the corresponding text in the persistent ad at the same time. Reserved ad and field dimensions prevent typing from moving the composition. Review arrives with empty values, then types its three values at the same character speed before approval; value columns reserve their full width and two-line height. The marketing-only focal travel lasts 640ms; the right-panel handover uses 640ms with a subtle 0.94 scale and independently eased exit/entry phases; browsing uses 620ms moves with 400ms holds, and approval uses 350ms. After selecting an ad, hold 800ms; after editing, hold 600ms; after Review typing, hold 400ms. Autoplay holds start after movement and typing finish, pause out of view, and yield to screen selection. Reduced motion applies the selected state immediately. Existing imagery and Motion dependency are reused; no video or added animation engine.

Workflow text handovers fade the outgoing text before introducing the replacement inside the same fixed surface. Headline and field layers must never create double-exposed text during normal forward or reverse playback.

The workflow frame has no bottom hint bar. Customise keeps intrinsic two-line Headline and three-line Ad text fields, never stretching a field to fill the panel.

Reporting Email uses one compact notification with a small creative thumbnail and a two-column details grid. Its full content, including preferences, fits the fixed reporting frame without an inner scrollbar or a fade concealing content. The chart and email views retain the same frame height.
