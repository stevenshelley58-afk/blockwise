# Trial offer correction: homepage copy, Ad Builder demo, reporting card

Owner brief, 15 September 2026. Written for an agent to execute. Read this file
top to bottom before touching anything. Reviewed with the hallmark copy skill and
the impeccable UI audit method.

## 1. The offer. This is the single source of truth

Every string, fixture and gate below must agree with this list. Where an existing
doc disagrees, the doc is stale and gets corrected in the same change.

1. One free ad pack. A pack is one Feed ad plus one Story/Reel ad. Not three.
2. The new user creates, edits and previews the ad for free. No card to get that far.
3. Credit card details are captured when the user clicks Publish.
4. Publishing is free. Blockwise charges nothing during the trial. The card is held
   for the subscription that starts on day 8.
5. Meta ad spend is paid by the customer to Meta from their own ad account. Blockwise
   never bills ad spend.
6. At Publish the user picks a daily budget from presets and must see the 7 day total
   before confirming.
7. The trial campaign runs for 7 days only. An end time is set at publish so it cannot
   run past it.
8. 7 days of the Blockwise dashboard.
9. Day 8: subscribe and the ad keeps running. Do nothing and the ad stops.

## 2. What the code actually does today

Verified in the repo on 15 September 2026. Do not trust the dated docs over this.

| Thing | Reality |
|---|---|
| Free allowance | 6 render credits = 3 packs. Hard coded as `6` in SQL in three places in `supabase/migrations/20260906010000_no_card_trial_delivery_start.sql`, and as `FREE_TRIAL_RENDER_LIMIT = 6` in `src/lib/trial/trial-status.ts:1`. `normalizeTrialStatus` rejects any status whose granted renders is not 6. |
| Trial window | 30 days pending delivery, then 14 days from first Meta delivery. Both in the same migration. No 7 day window anywhere. |
| Trial expiry enforcement | None. `trialExpired` is read in one place, `src/components/trial-status-pill.tsx:50`, to pick a label. It gates no route. |
| Card capture | Exists only as hosted Stripe Checkout in subscription mode, triggered from `src/app/(customer)/settings/billing-section.tsx:76`. No SetupIntent anywhere. Nothing in the publish flow touches Stripe. |
| Ad set end time | Already exists and is already required. `MetaPublishControls.schedule` in `src/lib/providers/meta-execution.ts:122`, enforced at `src/lib/adbuilder/publish-adapter.ts:761`. A 7 day window needs no new provider work. |
| Daily budget presets | Already exist: 10 / 20 / 30 / 50, default 20, in `src/app/(customer)/ad-builder/templates/[templateId]/publish/publish-flow.tsx:122,339`. |
| Projected total spend | Does not exist. `publish-flow.tsx:392` currently says "Daily spend can vary. No total spending cap is set." |
| `?offer=ad-studio` | Silently dropped. `src/app/signup/page.tsx:27` only reads `auditId`. |
| Real per lead email | Does not exist. `lead-digest` in `src/lib/email/lead-lifecycle.ts:93` is a hand written HTML table with no caller. The `src/lib/email-design/` renderer is used only by postcode outreach. |
| Homepage lead email | A marketing mock, `src/lib/homepage-concept/lead-email.ts`, sharing nothing with the product. |

Consequence: most of the corrected copy describes behaviour that does not exist yet.
Sequencing in section 9 is not optional.

## 3. Open questions the owner must answer before copy ships

1. Ad studio lists both "100 render credits each month" and "Up to 50 Feed + Story ad
   packs". Two units for one allowance, neither defined on the site. Which is real?
2. Is "One campaign" still part of the free offer now that the free tier is one pack?
3. Day 8 price. The page implies A$249 Ad studio. Confirm the card taken at Publish is
   for Ad studio at A$249 and not a different conversion price.
4. "Five team members, one brand and one Meta ad account" on Ad studio is unverified in
   any product doc.
5. Support channel and hours for Ad studio. Current copy says "Help when you need it",
   which is nothing.
6. What happens to a trial user who arrives without a Meta ad account.
7. `PRODUCT.md` says publishing "remains approval and provider configuration gated".
   The homepage would promise a live 7 day ad. Confirm the provider write gate is open
   for trial workspaces before the page claims it.
8. `docs/design/homepage-concept.md` records the approved reporting headline as
   "Know how your ads are going." The shipped headline is "See your leads. Know your
   costs." Confirm which is current. This plan recommends the recorded one.

## 4. Workstream A. Homepage copy

Files: `src/components/homepage-concept/homepage-concept.tsx`,
`src/components/homepage-concept/homepage-pricing.tsx`,
`src/lib/homepage-concept/pricing.ts`, `src/lib/homepage-concept/content.ts`,
`src/components/homepage-concept/results-reporting.tsx`,
`src/components/motion-study/workflow-motion-study.tsx`,
`src/components/homepage-concept/homepage-booking.tsx`.

House rules: no em dashes anywhere. No matched pair cadence. One CTA label sitewide.

### Locked. Do not touch
`PRODUCT.md` locks the hero headline. Leave `More leads.` / `Less ad management.`
exactly as it is.

### homepage-concept.tsx

- Hero lede. From `Blockwise helps real estate agents create, review and run Facebook and Instagram ads in one place.`
  to `Real estate agents build Facebook and Instagram lead ads here, review them, and watch the leads arrive.`
- Hero trust chip. From `No card required.` to `Build and preview free. Card only when you publish.`
- FAQ subhead. From `Useful details before you start.` to `What the trial costs, what Meta costs, and what happens on day 8.`
- Trial band heading. From `Ready to make your next ad?` to `Make your first ad.`
- Trial band body. From `Start with three Feed and Story packs. No card is required, and you only pay if you choose a paid plan.`
  to `One free ad pack: one Feed ad and one Story ad. Build and preview them free. Add a card to publish, pick a daily budget, and the ad runs 7 days. Blockwise charges nothing during those 7 days.`
- Trial band footnote. From `Meta ad spend is paid separately.` to `You pay Meta for the ad spend, from your own Meta ad account.`
- Footer tagline. From `Real estate ads, made manageable.` to `Facebook and Instagram lead ads for real estate agents.`

### homepage-pricing.tsx

- Heading. From `Start free. Sign up when you're ready.` to `One free ad pack. Subscribe on day 8 if it works.`
- Lede. From `Three Feed and Story packs published to your Meta ad account. Yours to keep, no card is needed. 7 days of your personal Blockwise dashboard.`
  to `One Feed ad and one Story ad, published to your own Meta ad account. Your card is taken at Publish and is not charged during the trial. You get 7 days of ads and 7 days of the dashboard.`
- Disclosure label. From `More plan details` to `What else is included`.

### pricing.ts

Free plan:
- `billing`: `No Blockwise subscription fee` to `Free for 7 days`
- `outcome`: `Make your first ads without adding a card.` to `Build, preview and publish one ad pack.`
- `included`: `["Three Feed + Story ad packs", "One campaign"]` to
  `["One ad pack: one Feed ad, one Story ad", "7 days of ads and dashboard", "Unlimited editing and preview before you publish"]`
- `note`: `You only pay Blockwise if you choose a paid plan.` to
  `On day 8 the ad stops unless you subscribe. Nothing is charged before then.`
- `details`: to `["Your designs and your leads stay in your account after day 8", "You pay Meta for the ad spend, from your own ad account", "Your card is stored for the subscription, not charged during the trial"]`

Ad studio:
- `outcome`: `Create and manage your own ads.` to `Keep publishing after the trial, with no run length limit.`
- `included`: resolve question 3.1 first. Proposed `["Up to 50 ad packs each month", "Ads run as long as you keep them running"]`
- `note`: to `Billed A$249 monthly from day 8. Cancel before day 8 and you are not charged.`
- `details`: to `["Five team members, one brand, one Meta ad account", "<confirmed support line>"]`

Managed:
- `outcome`: to `We set the ads up and run them for you.`
- `included`: fix the rendered slug `Everything in ad-studio` to `Everything in Ad studio`
- `note`: to `Monthly. Cancel anytime.`
- `details`: to `["Weekly campaign changes and a monthly report", "We quote in writing before you pay anything"]`

`TRIAL_CTA_LABEL` stays `Start your free trial` and becomes the only label. Make
`workflow-motion-study.tsx` import it instead of hard coding `Start free trial`.

### content.ts, FAQ

- `What do I need to provide?` answer gains the card: `Your email to start, then your branding, photos and ad details. A card when you press Publish. You review everything before it goes live.`
- `What does the free option include?` becomes `What does the free trial include?` answered
  `One ad pack, which is one Feed ad and one Story ad. You build, edit and preview them for free. The ad runs for 7 days and you get the dashboard for those 7 days.`
- `What happens after the free allowance?` becomes `What happens on day 8?` answered
  `Subscribe and the ad keeps running. Do nothing and the ad stops. Your designs and your leads stay in your account either way.`
- `Will the free option charge my card?` becomes `Why do you need my card if the trial is free?` answered
  `The card is for the subscription that starts on day 8. Blockwise charges nothing during the 7 days. If you do not subscribe, the ad stops and the card is never charged.`
  This is the single most important new answer on the page.
- New under Plans: `How long does the trial ad run?` answered `7 days. We set the end date when you publish, so it cannot run past it.`
- New under Costs: `What will the trial cost me at Meta?` answered
  `You pick a daily budget from a short list when you publish. We show you the 7 day total before you confirm. At A$20 a day that is A$140, paid to Meta, not to us.`
- `What does Ad studio cost?` to `A$249 per month. Cancel anytime. Meta ad spend is on top and goes to Meta.`
- `How do I cancel Ad studio?` drop the `remaining credits` clause.
- `Who owns my ad account and ad data?` to `You do. It is your Meta ad account, your designs and your leads.`
- `What support is included?` needs the confirmed channel from question 3.5.
- Collapse the duplicate pair `Can I talk to someone before choosing?` and `Can I arrange a Perth meeting?`
  into `Can I talk to someone first?` answered `Yes. Email us. We can do a call, or meet in person if you are in Perth.`
- `Let's talk` group heading to `Talking to us`.
- `BOOKING_POINTS`: drop `No card required` and `No obligation to continue`. Proposed
  `["20 minutes, by video or phone", "We look at your suburb and your listings", "No sales script"]`
- `Is Meta ad spend included?` and `Does Blockwise guarantee leads or sales?` are correct. Leave them.

### workflow-motion-study.tsx, the Ad Builder section

- Lede. From `Get from a proven template to an on-brand lead ad, ready to review in one clear flow.`
  to `Pick a template, put your own photo and words on it, and check it before it runs.`
  `proven` is an unsupported claim and `on-brand` is jargon.
- Trust strip. From `Free trial · No card required · Cancel anytime` to
  `Build and preview free · Card only at Publish · Ad runs 7 days`
- Panel heading `Make it yours` to `Your headline, your photo`.
- `REVIEW_TEXTS` at line 30 currently reads `["Homeowners and potential sellers", "$20 per day", "14 days"]`.
  The `14 days` is a hard factual contradiction of the offer and the `$` is inconsistent with `A$` elsewhere.
  Change to `["Homeowners and potential sellers", "A$20 per day", "7 days, A$140 total"]` and
  relabel the third `<dt>` from `Duration` to `Runs for`.
  Keep the section heading `Build lead ads. Skip Ads Manager.` It is the best line on the page.

### results-reporting.tsx

- Heading. Restore the recorded approved line `Know how your ads are going.` in place of
  `See your leads. Know your costs.`, which is matched pair cadence. Subject to question 3.8.
- Lede. Restore `Your personal dashboard. Emails as often as you like. Even never. We get it.`
  and add the trial window: `On the free trial you get 7 days of it.`
- `REPORT_BRIEFS.week`: `Your last 7 days` restates the tab label above it. Use `Leads and spend, day by day`.

## 5. Workstream B. The Ad Builder demo is too small

All in `src/components/motion-study/`. Measured at 390pt, where `.hc-shell` gives a
356px stage. Findings are ordered by impact.

1. `workflow-motion-study.module.css:221` caps the ad at `min(224px, calc(100% - 28px))`,
   so the literal 224px always wins and 36% of the width is thrown away. The srcset ladder
   in `src/lib/homepage-concept/creative-image.ts:5` is authored for a 326px Feed card, so
   the CSS contradicts the asset pipeline. Change to `calc(100% - 32px)`. Same for `:238`
   (`.bwStudyBrowseAd`).
2. `workflow-motion-study-geometry.ts:2` applies `STUDY_AD_SCALE = 0.78` on phones as well
   as desktop. On desktop it exists to make room for the editor panel beside the ad. On
   narrow the panel stacks below, so there is no competition, yet the card still shrinks to
   175px and the 14px headline overlay renders at an effective 10.9px. Gate it:
   `const scale = narrow ? 1 : STUDY_AD_SCALE;` in `studyAdMotion` (lines 49, 52, 54) and in
   `studyEditLayout` (lines 22, 23).
3. `workflow-motion-study.module.css:227` hides `.bwStudyAdCopy`, `.bwStudyLink` and
   `.bwStudyActions` on narrow, leaving avatar plus "Ad preview / Sponsored" plus image.
   That is a thumbnail, not an ad, and it breaks `DESIGN.md:35`, "never use a tiny desktop
   screenshot as a substitute for a mobile composition". Restore `.bwStudyAdCopy` (fixed
   64px) and `.bwStudyLink` (fixed 58px). Both are fixed height so nothing reflows during
   the typing animation. Keep `.bwStudyActions` hidden only if the height budget forces it.
4. `workflow-motion-study.module.css:228` overrides the image to `aspect-ratio: 1.7` on
   narrow, against `4 / 5` at `:120`. A Meta Feed lead ad is 4:5 or 1:1. Delete the override,
   or set `1 / 1` if 4:5 is too tall for the section.
5. `workflow-motion-study.module.css:219` hard codes the stage to `height: 650px` on a pale
   `#e8edf2` ground. With today's geometry the Choose scene fills 17% of it, which is the
   empty space in the owner's screenshot. Stop hard coding: `studyEditLayout` already
   computes `panelTop`, so return a `stageHeight` next to it and expose it as
   `--study-stage-h` on the stage element. The component already writes
   `--study-panel-left/top/width` at `workflow-motion-study.tsx:225`, so the seam exists.
6. `workflow-motion-study.module.css:224` gives the editor panel a fixed 400px for about
   230px of content. Size to content once the stage height is derived. Note
   `tests/workflow-motion-study.test.mjs:67-68` pins `392px` and `400px`.
7. `workflow-motion-study.tsx:93` initialises geometry to a desktop guess
   (`stageWidth: 695`), so the phone server renders `data-narrow="false"` and snaps after
   measurement. Initialise to `null` and render the narrow branch until measured, or drive
   `data-narrow` from a container query. `.bwStudy` already declares
   `container-type: inline-size` at `:17`.
8. `workflow-motion-study.tsx:68` declares `sizes="300px"`, which matches no rendered width
   before or after this change. Use `sizes="(max-width: 1099px) calc(100vw - 64px), 300px"`.
9. The Ad Builder frame builds its own radius, border, shadow and a private
   `--study-*` palette at `module.css:9-29`, duplicating `--hc-*` with different hexes,
   while `src/components/homepage-concept/demo-card.css:1` states that every animated
   homepage surface takes one frame. Add `hc-demo-card` to the frame and delete the
   duplicated chrome.
10. Accessibility. `workflow-motion-study.tsx:44-47` renders two real `<textarea>` elements
    that a keyboard user can tab into and a screen reader reads as live typing fields.
    `e2e/homepage-concept-rework.spec.ts:317` asserts the demo contains zero
    `input, textarea, select, button`, so the replacement component reintroduced exactly
    what the spec forbade. Add `tabIndex={-1}` and `aria-hidden="true"`, or use styled divs.
11. Three `<h2>` in one section, two of them UI chrome (`:214`, `:235`, `:240`). Demote the
    two inside the picture.
12. `module.css:201` sets `white-space: nowrap` on headline lines at `clamp(26px, 8.4vw, 46px)`.
    At 390pt "Skip Ads Manager." clears the shell by about 50px with no warning if the copy
    changes. Add `max-width: 100%`, or switch to `text-wrap: balance`. Pinned by
    `tests/workflow-motion-study.test.mjs:91,201`.

Already correct, do not churn: the autoplay is bounded, pauses off screen and at
`scene === 3`, settles immediately under reduced motion; the narrow selector is already a
44px target with a visible focus ring; textareas already use 16px to prevent iOS zoom.

## 6. Workstream C. Reporting card: drop 30 days, show the real lead email

### C1. Remove the 30 day view completely

`src/lib/homepage-concept/reporting.ts`
- `:2` `ReportRange` narrows to `"week"`, or delete the type.
- `:13-20` delete the whole `month` fixture.
- `:42` `lineChartGeometry(points, maximum)` now only ever receives 4. Keep the parameter,
  audit callers.

`src/components/homepage-concept/results-reporting.tsx`
- `:12` the `ReportRange` import, `:17` `ReportingView`, `:18` `REPORT_VIEWS`,
  `:19` the `month: "30 days"` label, `:21-25` the `month` brief,
  `:26` `CHART_MAX` becomes a single `const CHART_MAX = 4`,
  `:33` delete `VIEW_TOUR`, `:29-31` `DRAW_MS` / `HOLD_MS` / `EMAIL_HOLD_MS` are tour only,
  `:38` the second `range` state is now redundant with `view`, `:52-56` `chooseView`,
  `:63-72` the `matchMedia` effect's `[range]` dependency, `:94-109` the whole auto tour,
  `:112-124` the indicator measurement with `:41` and `:44`,
  `:154-168` the `.rr-views` block, `:173` the desktop branch, `:183` `CHART_MAX[range]`.

`src/components/homepage-concept/results-reporting.css`
- `:24-29` `.rr-views`, the pressed button, `.rr-view-indicator`, `.rr-view-brief`.
- `:87` and `:118` the fixed `--rr-stage-h` of 512px / 505px. The frame no longer has to be
  the max of three views, so size it to content.
- `:95-98` and `:119-122` the mobile overrides, including the ≤360 rule that sets the
  product name to `font-size: 0` to make room for three pills. Its reason disappears.
- `:133` the `.rr-view-indicator` reduced motion rule.

`src/components/homepage-concept/results-reporting.module.css`
- `:17` the topbar gap tuned for the old row. `:20-25` `.email` stays, but reconcile so the
  email is not rendered twice at any width.

### C2. The selector should go entirely, not shrink to two

With `month` gone, the two remaining entries are not two ranges of one thing. They are two
different artefacts: a 7 day stat panel and a lead email. A segmented pill signifies
"pick a time window", which would be false. The desktop path already proves the point, it
shows both side by side with no selector, and after removal its selector would render a
single permanently pressed button (`results-reporting.tsx:162`).

Do this instead: one content sized frame, the 7 day dashboard above and the lead email
below, "Last 7 days" moved into the header line next to `Blockwise Reporting`. If the owner
wants the email behind a control, use one labelled disclosure, not a range picker.

This also fixes three separate audit failures for free: the selected tab label was
3.87:1 against its own pill (`results-reporting.css:26` on `:28`, below the 4.5:1 bar in
`docs/design/design-system.md:93`), every tab was a 32px touch target against the 44px floor
in `DESIGN.md:20`, and the auto tour changed the card twice under the reader while
`aria-live="polite"` announced each change. The `$1,116` figure in the 30 day fixture was
also the only number that overflowed its metric cell at 390pt.

### C3. The real lead email

The owner asked for "the actual lead gen email from templates". There is no such template.
`lead-digest` in `src/lib/email/lead-lifecycle.ts:93` is a hand written HTML table of N
leads with no caller, which does not match a single lead card. The design system in
`src/lib/email-design/` is used only by postcode outreach. So this is a build, not a swap.

1. Author a genuine `new-lead` template as an `EmailMessage`
   (`src/lib/email-design/types.ts`) rendered through `renderEmail`
   (`src/lib/email-design/renderer.ts`), and wire it to the lead arrival path so it is
   really sent. Until it is sent, the homepage cannot honestly call it the email we send.
2. Feed the homepage preview from that one definition. `renderEmail` is a pure string
   builder with no node or Supabase imports, so it can run client side, but it returns a
   full document with inline styles and `<style>` blocks. Dropping that into the page would
   leak email CSS into the homepage. Either generate a build time fixture and map the
   `EmailMessage` fields onto the existing `rr-lead-email-*` markup, or render it in a
   sandboxed `<iframe srcdoc>`.
3. Constraint. `tests/homepage-reporting.test.tsx` forbids `fetch(`, `localStorage`,
   `supabase`, `mailto:`, `tel:`, em dashes and real email addresses anywhere in the preview
   tree. `safeHref` in the renderer allows `mailto:`, so a real template containing one trips
   the test. Keep the example data honest: `@example.com`, masked phone, visible
   "Example data" label. That half of the card is already correct.

## 7. Workstream D. Everything off the homepage that repeats the wrong offer

Correcting the homepage while these stand is worse than doing nothing, because the first
click lands on one of them.

- `src/app/signup/page.tsx:13` `Create your first three real estate ads with Blockwise. Email only, no password and no card required.` This is where the CTA goes.
- `src/components/home-landing/home-sections.tsx:354` `no card required. Build and review three Feed + Story ad packs` (also contains an em dash) and `:368` `<h3>No card</h3>`.
- `src/components/pricing/pricing-faq.tsx:24` and `:54`.
- `src/components/pricing/market-pricing.tsx:17,19,81` including `Your 14 days start when your first ad runs on Meta.`
- `src/components/ad-studio/activation-card.tsx:150` `Your free trial never requires a card.` Shown inside the product to a user who has already given a card.
- `src/app/suburb/[postcode]/report-client.tsx:166,309,314` `14 days free · No credit card`, `run these 3 ads today`, `starts with a 14-day free trial` (two em dashes).
- `src/components/outbound-report/report-view.tsx:37`.
- `src/lib/billing/offers.ts:27` `AD_STUDIO_TRIGGER`. This string is Checkout facing legal copy, so it changes with billing review, not as a copy tweak.

## 8. Workstream E. Product work that has to exist for the copy to be true

Ordered by how much of the page depends on it.

1. **Card at Publish.** Does not exist. Subscription mode Checkout charges immediately,
   which breaks "nothing is charged during the trial", so this needs a Stripe Checkout
   session in `setup` mode or a SetupIntent, saving a payment method against the customer
   without a charge, then reusing it for the day 8 subscription.
   Client seam: the `publish()` handler behind `Approve & publish` in
   `.../publish/publish-flow.tsx:393`.
   Server seam: `src/app/api/adbuilder/ads/[id]/publish/route.ts` POST, right after
   `controls.activationApproval` is stamped at `:161` and before `freezePublicationSnapshot`.
   Precedent for a server first payment gate on an action:
   `src/app/api/adbuilder/videos/[id]/checkout/route.ts` with `assertCheckoutEnabled`.
   The publish worker already reads `billing_access_state` at
   `src/lib/providers/meta-publish-worker.ts:670`.
2. **One pack, not three.** Change the grant from 6 credits to 2 in all three call sites in
   `supabase/migrations/20260906010000_no_card_trial_delivery_start.sql` via a new
   migration, and `FREE_TRIAL_RENDER_LIMIT` in `src/lib/trial/trial-status.ts:1`. Note
   `normalizeTrialStatus` rejects any granted value other than the constant, and
   `get_trial_status` divides by `RENDERS_PER_AD_PACK` to report packs. `tests/trial-status.test.ts:9`
   is named for the three pack behaviour and will need rewriting.
3. **7 day trial window.** Replace the 30 day pending and 14 day post delivery intervals
   with 7 days in a new migration, and decide whether the clock starts at publish or at
   first Meta delivery. The copy says the ad runs 7 days, so publish is the honest anchor.
4. **7 day campaign end time.** No provider work needed. `endIntent: "scheduled"` with
   `endAt = publish + 7d` already flows to the Meta ad set. Add a trial default so the user
   is not asked to pick it, and make it not overridable on the free trial. Note Meta's
   `end_time` is the only stop mechanism today, nothing in Blockwise re checks or force
   pauses, and the `existing_adset` target mode deliberately rejects a schedule
   (`publish-adapter.ts:728`).
5. **Total spend disclosure.** Presets already exist at
   `publish-flow.tsx:339` (10 / 20 / 30 / 50, default 20). Add `daily × 7` next to the
   selection and on the Review step, and replace `Daily spend can vary. No total spending cap is set.`
   at `:392` with the trial truth: the campaign ends after 7 days, so the total is bounded
   by the end time, and Meta bills it, not Blockwise.
6. **Day 8 behaviour.** "Subscribe and the ad keeps running" needs an implementation: the ad
   set carries a hard `end_time` at publish + 7d, so subscribing has to extend or replace it.
   Decide and build that, or change the copy.
7. **7 days of dashboard.** There is no trial access gate at all today, and no
   `middleware.ts`. If the copy says 7 days of the dashboard, something has to enforce it, or
   the copy should say the ad runs 7 days and stay quiet about dashboard expiry.
8. **`?offer=ad-studio`.** Either make `src/app/signup/page.tsx` read it or drop it from the
   CTA. A parameter that does nothing will mislead the next agent.
   Note `tests/homepage-pricing.test.mjs:12` pins the exact URL literal.

## 9. Sequencing

Copy must not ship ahead of product truth, and today's copy is already false in the other
direction, so neither order is safe on its own.

- Phase 1, safe now, no product dependency: Workstream B (Ad Builder sizing), C1 and C2
  (remove the 30 day view and the selector), the dead code deletions in section 10, and the
  copy defects that are only quality defects rather than offer claims: the hero lede, the
  Ad Builder lede, `Make it yours`, the FAQ duplicates, the footer tagline, the reporting
  headline, `Everything in ad-studio`.
- Phase 2, blocked on E1 to E5: every string that mentions the card, the pack count, the 7
  day run or the total spend. Ship Workstream A and D in one change with the product work,
  not before it, and not after it.
- Phase 3: C3, the real lead email, once a `new-lead` template is actually sent.

If phase 2 cannot land soon, the interim position is to remove the false claims rather than
replace them with new ones. Delete "No card required" and drop "three" without promising
"one" until the grant changes.

## 10. Dead code to delete in the same change

- `src/components/homepage-concept/workflow-showcase.tsx` (869 lines) and
  `workflow-showcase.css` (770 lines). Nothing imports `WorkflowShowcase`; the only
  reference is its own export at `:637`. It carries a second copy of
  `Free trial · No card required · Cancel anytime` at `:790-792`, so the next grep for the
  false claim finds dead code and someone "fixes" it.
  Careful: `workflow-showcase.css:1` is the only definition of `.hc-process`, which
  `homepage-concept.tsx:54` still renders. That section is currently unstyled in production
  and survives by accident. Move the rule into `src/app/concept/concept.css` first.
- `src/lib/homepage-concept/workflow.ts`, referenced only by the dead component.
- `src/components/homepage-concept/homepage-pricing.css:20-23,36` define `.hp-plan-cta` and
  variants that the component never emits.
- `tests/homepage-workflow.test.mjs` tests a component that does not render.
- `tests/homepage-concept.test.mjs:135-148`, the "both demo cards take one header format"
  guard, compares the live reporting card against the dead `workflow-showcase.css`. It
  passes while the invariant is broken. Repoint it at the motion study.
- `tests/public-homepage.test.ts:30` lists `workflow-showcase.tsx` under a comment claiming
  it lists only rendered components, and omits `src/components/motion-study/` entirely.
  `readHomeStyles()` at `:44` never sees `workflow-motion-study.module.css`. The live Ad
  Builder is covered by none of the homepage guards. Fix both.
- `e2e/homepage-concept-rework.spec.ts` drives `.hc-process-demo`, `.hc-story-viewport` and
  other dead selectors, and at `:322` expects the string `Last 30 days. Example leads by day.`
  which exists nowhere in `src/`. It is already stale and is not in CI. Repair or retire it.

## 11. Tests that will fail, and must be updated deliberately

| File | Assertion |
|---|---|
| `tests/homepage-reporting.test.tsx:57` | the exact `REPORT_VIEWS` literal including `"month"` |
| `tests/homepage-reporting.test.tsx:30-38` | `lineChartGeometry` branch on `id === "week" ? 4 : 12` |
| `tests/homepage-concept.test.mjs:145` | pins `.rr-views button` `min-height: 32px`, which is itself the accessibility defect |
| `tests/homepage-concept.test.mjs:147` | `className="rr-view-brief"` |
| `tests/homepage-concept.test.mjs:122-124` | `--rr-stage-h` 512px / 505px |
| `tests/homepage-concept.test.mjs:35` | `Start with three Feed and Story packs.` |
| `tests/homepage-pricing.test.mjs:18` | `Three Feed + Story ad packs` and `One campaign` |
| `tests/homepage-pricing.test.mjs:12` | the exact `TRIAL_SIGNUP_URL` literal |
| `tests/public-homepage.test.ts:291-293,296` | `No card is required`, `you only pay if you choose a paid plan`, `three Feed and Story packs`, `14 days start when your first ad runs on Meta` |
| `tests/workflow-motion-study.test.mjs:67-68,87-88,91,199,201` | panel heights 392/400px, the headline strings, `white-space: nowrap` |
| `tests/trial-status.test.ts:9` | the three pack to six credit mapping |

A test that pins false copy is not protection. Update it in the same commit that changes
the copy, and say in the commit which invariant the assertion was defending.

## 12. Docs to correct in the same change

- `docs/design/homepage-concept.md:5` says `Say "Start free trial" and "No card required", never promote a numbered free-ad allowance.` Both halves are now wrong.
- `DESIGN.md:39` keep `Show the actual allowance, renewal, charge, cancellation and ad-spend terms beside the decision that needs them`, which is exactly the rule the new offer needs. Strike the `No card required` clause.
- `DESIGN.md` reporting paragraph, about line 294: `The desktop chart selector contains only 7 days and 30 days` becomes false. `DESIGN.md:132` requires it to be amended in the same commit.
- `DESIGN.md` homepage workflow paragraph, about line 296, still records the headline as `Be the agent / they think of first.` The shipped copy is `Build lead ads. / Skip Ads Manager.` The doc is stale, the code is right.
- `docs/design/homepage-chat-reconciliation.md` records six FAQ answers and the subheading `What to expect before you start.` There are now fifteen answers and the subheading is different.
- `docs/runbooks/progressive-onboarding-rollout.md` fixes the offer at US$99 / US$499 across US and AU. Code is AU only at A$249 / A$1,500. Its `BLOCKWISE_PROGRESSIVE_*` flags do not exist in `src/`. It is marked historical, but its "offer contract is fixed" section reads as current.
- `PLANS.md` gets one entry for this workstream, per its own one writer rule.

## 13. Acceptance checks

1. `grep -ri "no card" src/` returns nothing outside billing legal copy.
2. `grep -ri "three feed\|three ads\|3 ads\|14 days\|14-day" src/` returns nothing on any
   customer facing surface.
3. `grep -rn "30 days" src/components/homepage-concept src/lib/homepage-concept` returns nothing.
4. At 390 x 844, the Ad Builder ad card measures 326px wide, shows headline, post copy,
   image at 4:5 or 1:1 and the link row, and the stage has no band of empty ground taller
   than one card gap.
5. At 390 x 844, no control in the reporting or Ad Builder sections is under 44px, and every
   text colour on its own background measures at least 4.5:1.
6. The reporting card shows 7 day figures and the lead email with no range selector.
7. A new user can reach a published ad without a card, is asked for a card at Publish, sees
   the daily budget and the 7 day total on the Review step before confirming, and the created
   Meta ad set carries an `end_time` exactly 7 days out.
8. The trial wallet grants 2 credits, and `get_trial_status` reports one pack.
9. `npm test` green, with every changed assertion explained in the commit message.
10. Read the changed strings aloud. If a sentence has two clauses saying one thing, cut one.

## 14. Where this came from

Owner brief with four phone screenshots, 15 September 2026. Copy reviewed with the hallmark
skill, references `copy.md`, `slop-test.md`, `anti-patterns.md`. UI audited with the
impeccable skill, `audit.md`, `critique.md`, `layout.md`, `craft.md`, scoring 9 of 20 across
the three sections. Code state traced against the repo, not the dated docs.
