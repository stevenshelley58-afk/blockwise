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

## Motion

- **Motion timings have one source.** src/lib/motion.ts is the single source of truth. Pages and components import from there and never define their own timings.
- **The motion vocabulary.** Springs: snappy for micro-interactions, gentle for entrances, slow for progress bars and meters. Durations: micro 150ms, state 250ms, entrance 350ms. Nothing on the customer surface moves slower than entrance.
- **Entrance and count-up.** Entrance is a 12px rise and fade, staggered 40ms between siblings, once per navigation. KPI numbers count up over 900ms. Both swap to their final state under reduced motion.
- **Reduced motion is mandatory.** Every transform is gated: useReducedMotion for motion/react, the motion-reduce variant for CSS. There is exactly one confetti moment, the first-run handoff into Ad Studio; it is brief, never loops, and is skipped entirely under reduced motion.
- **Hover lift is reserved.** Hover lift applies only to genuinely interactive cards.

## States

- **Every data surface ships four states.** A surface that can load, be empty, succeed or fail renders all four. No dead ends.
- **Unavailable is not zero.** Show unavailable reporting as unavailable with a contextual recovery link. Never substitute zero for missing data.
- **No fabricated data in a card.** Every card renders an explicit ready, empty, attention, unavailable or error state and must not fabricate data.

## Components

- **Reuse the shared vocabulary.** src/components/ui/ is the shared vocabulary for buttons, cards, dialogs, sheets, tables, selects, inputs and navigation. Build from it before creating anything new.
- **Hierarchy before containers.** Use sections, rows, hairlines and disclosures before rounded cards or chart scaffolds. Keep Home flat by default.
- **Lead with the customer's real creative.** Home leads with the customer's creative and keeps its next action linked to a server-resolved, available route.
- **Guides are content-first.** Lead with the useful content, use rounded panels only when they improve grouping, and keep promotion subtle and secondary.
- **Help owns the walkthrough.** `/help` is the customer destination for provider walkthroughs, screenshots, tips and edge cases. A working screen keeps only the instruction its next action needs, plus one link to Help; it never carries the manual. The Meta sharing steps in `src/components/meta/partner-steps.ts` are the single source shared by `/connect-meta` and Help, so the checklist and the walkthrough cannot drift apart.
- **The customer never transcribes provider IDs.** A customer confirms what they shared in the provider's own screens; the operator reads the resulting asset IDs from the provider and records them. Never ask a customer to find and type an account, Page or pixel ID.

## Accessibility

- **Accessibility is part of done.** Controls keep accessible names and roles, focus is visible and ordered, and colour is never the only carrier of meaning. Accessibility text is functional copy and is never trimmed by the fewer-words rule.

## How to change this system

- **Changing the system.** A new accent family, radius scale, typography system or navigation grammar is a system change: it needs the owner's decision and a DESIGN.md change in the same commit. A purpose-built surface that reuses the existing vocabulary is not a system change.


---

## Changelog

- 2026-09-11: condensed to binding rules. Reference material, worked examples and
  route inventories moved out; token values, the motion vocabulary and the owner
  preferences kept verbatim from the previous version.
