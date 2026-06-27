# Blockwise Landing — Craft Review

Date: 2026-06-27. Scope: the public landing page only (`src/app/page.tsx`,
`src/app/landing.css`, `src/components/landing/*`, `src/app/layout.tsx`).
Method: applied the design-engineering skills — `emil-design-eng`,
`make-interfaces-feel-better`, `review-animations`, `redesign-existing-projects`,
`design-taste-frontend`.

This **builds on** `UI-UX-REVIEW-AND-PLAN.md` (2026-06-10); it does not repeat it.
Several items from that plan have shipped (see "Already right"). This pass is a
finer craft lens: interaction feedback, motion, numerals, and color cohesion.

---

## Verdict

The landing is genuinely not slop — semantic markup, real copy, reduced-motion
handling, skeletons, and finished form states are already in place. Two things
hold it back from feeling expensive, and both are low-risk:

1. **One brand decision:** the landing runs on bright blue `#006bff`, the app on
   navy `#123e75`. They need to be the same blue.
2. **Interaction feedback is missing:** no button has a pressed state. That single
   omission is what makes a polished page still feel slightly "flat."

Highest leverage, lowest risk: pick one blue, add scale-on-press, add tabular
numerals to the animated counters. None touch app logic.

---

## Already right (don't touch)

- **Accessibility/semantics** — `<main id="main">`, `<nav aria-label="Primary">`,
  sections with `aria-labelledby`, `<article>` features, `aria-hidden` on
  decorative icons, `aria-label` on the icon-only brand link. (`page.tsx:494–540`)
- **Reduced motion** — honored in three places: `landing.css:330`,
  `home-motion.tsx:15` (bails entirely), `page.tsx:414`.
- **Form states** — spinner, `aria-busy`, `role="status"/"alert"`, `aria-live`,
  honeypot. (`demo-form.tsx`) This is premium-tier already.
- **Font smoothing** applied at the root (`globals.css:88–89`).
- **Skeletons + tinted shadows** — `lp-slab-skel`, `lp-radar-skeleton`, slate/blue
  shadows instead of pure black. The off-brand `#2563eb` is gone and radius
  tokens (`--r-ctl/-card/-panel`) are adopted.
- **Copy** — no AI clichés ("elevate/seamless/unleash" grep is empty); the hero
  ("Your competitors are advertising. Are you?") is plain and specific.

---

## Findings

### 1. Brand color drift — pick ONE blue  *(decision needed)*
`redesign-existing-projects`: "More than one accent color. Pick one."

| Before | After | Why |
| --- | --- | --- |
| `--lp-primary: #006bff` (`landing.css:8`) drives the whole landing | Set to the brand `#123e75` **or** consciously rebrand the app to `#006bff` | Landing (`#006bff`) and product (`#123e75`) are two different blues. One product = one accent. |
| Hero ring `rgba(0,107,255,0.14)` (`landing.css:361`) | Match the app focus ring `rgba(18,62,117,.12)` | Focus rings should read as one system across landing → signup → app. |

This is the only finding that needs your input — see the bottom of the doc.

### 2. Interaction feedback — buttons must feel pressed
`emil-design-eng` ("buttons must feel responsive — `scale(0.97)` on `:active`");
`make-interfaces-feel-better` #12 (`scale(0.96)`). Verified: **zero** `:active`
rules in `landing.css`.

| Before | After | Why |
| --- | --- | --- |
| `.lp-btn-primary:hover{…}` only (`landing.css:62`) | add `.lp-btn-primary:active{ transform: scale(0.97) }` + `transition: transform 160ms ease-out` | Press feedback is the #1 thing that makes a UI feel alive; absence reads as flat. |
| `.lp-btn-hero`, `.lp-btn-ghost`, `.lp-btn-light` — hover only | same `:active` scale across all landing buttons | Consistency; every clickable surface should acknowledge the press. |
| Hover motion ungated (`@media (hover:hover)` count = 0) | wrap hover rules in `@media (hover:hover) and (pointer:fine)` | `review-animations`: ungated `:hover` sticks on touch devices after tap. |

### 3. Motion craft
`review-animations` (sub-300ms UI, justified motion, GPU props).

| Before | After | Why |
| --- | --- | --- |
| `.lp-slab-deck` transform `.6s` (`landing.css:239`) | keep only because it's decorative hero motion; cap interactive transforms at ≤300ms | 600ms would be a finding on a *control*; on a hero ornament it's acceptable — documented so it isn't copied onto buttons. |
| `lp-slab-sway 9s … infinite` (`landing.css:230`) | consider removing, or keep — it's already paused on `:hover/:focus-within` (`landing.css:232`) | Constant ambient motion is "motion that signals nothing." The pause-on-interaction is a good instinct; the open question is whether perpetual sway earns its place. |
| Counter eased cubic (`home-motion.tsx:33`) vs figure counter **linear** (`home-motion.tsx:49`) | use the same ease-out cubic for both | Two count-ups on one page easing differently reads as inconsistent. |

### 4. Numerals & headings
`make-interfaces-feel-better` #9 (tabular-nums) and #10 (text-wrap).

| Before | After | Why |
| --- | --- | --- |
| Animated KPIs (`#bLeads`, `#bCpl`, `.bwx-count`) have no tabular-nums (verified absent) | add `font-variant-numeric: tabular-nums` to those elements | The count-up rewrites the number every frame; proportional digits make the text jump width as it ticks. |
| No `text-wrap: balance` on landing headings | add to `h1`/`h2` (`.lp-hero h1`, section titles) | Prevents one-word orphan lines on the big headlines; near-zero risk. |

### 5. Forms — inline field validation
`redesign-existing-projects` ("No form validation").

| Before | After | Why |
| --- | --- | --- |
| `<form noValidate>` + `required` but no field-level checks; only server error shown (`demo-form.tsx:69`) | add lightweight inline validation (email format, required) before submit | `noValidate` turns off the browser's checks, so a bad email only fails after a round-trip. Everything else about this form is already excellent. |

### 6. Code shape — landing styles live in three places
`AGENTS.md`: "Delete > simplify > abstract… do not replace one messy file with
five." Not visual, but it's the root cause of color drift.

| Before | After | Why |
| --- | --- | --- |
| `FLOW_CSS` (`page.tsx:35`) + `DFY_CSS` (`page.tsx:426`) injected via `dangerouslySetInnerHTML` (`page.tsx:541,670`) | move both into `landing.css` | Styles split across `landing.css` (1,418 lines) + two inline strings + `globals.css` is exactly how a stray hardcoded `#006bff` escaped tokenization. One file = one place for the palette. |

---

## Priority order

| # | Fix | Impact | Risk | Where |
| --- | --- | --- | --- | --- |
| 1 | Pick one blue, retire the other | High | Low* | `landing.css:8–9`, ring at `:361` |
| 2 | `:active` scale on all landing buttons | High | Trivial | `landing.css:62,75` + btn rules |
| 3 | tabular-nums on animated counters | Med | Trivial | counter els + `landing.css` |
| 4 | `text-wrap: balance` on headings | Med | Trivial | `landing.css` headings |
| 5 | Gate hover behind `@media (hover:hover)` | Med | Low | hover rules in `landing.css` |
| 6 | Inline email/required validation | Med | Low | `demo-form.tsx` |
| 7 | Consolidate `FLOW_CSS`/`DFY_CSS` into `landing.css` | Med | Med | `page.tsx:35,426` |
| 8 | Unify counter easing; reconsider 9s sway | Low | Low | `home-motion.tsx`, `landing.css:230` |

\* Low *code* risk; the brand choice itself is yours.

---

## One decision for you

**Which blue is canonical?**
- **Navy `#123e75`** — match the app; landing becomes consistent with signup → product.
- **Bright `#006bff`** — keep the punchier landing blue and roll it into the app/brand tokens instead.

Everything in Priority #1 depends on this. The rest (press states, tabular nums,
text-wrap, hover gating) can ship immediately and independently — say the word
and I'll implement them as a focused, `npm run check`-clean change.
