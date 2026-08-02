# Homepage redesign — "The ad is the page" (Photographic)

Decision-complete implementation spec for redesigning the marketing homepage
(`/`). Written to be executed verbatim by an implementing agent. **Do not make
design decisions — every choice is locked below.** Where this spec is silent,
follow `DESIGN.md` (the locked design system), then `AGENTS.md`.

- **Hallmark**: verb `redesign`, single-page, `DESIGN.md`-managed project
- **Genre**: modern-minimal · **Theme**: locked DESIGN.md system (no catalog theme)
- **Macrostructure**: 08 · Photographic — full-bleed photo/ad folds, narrow text bands, captions not kickers, no scroll reveals
- **Nav**: N9 edge-aligned minimal · **Footer**: Ft5 Statement
- **Tone** (user-confirmed): audience = real-estate agents · use case = start free trial · tone = luxury (quiet, composed, photographic)

---

## 1. Concept

The current page is a templated SaaS layout: split hero, kicker+H2 card
sections, connector diagrams, reveal-on-scroll everywhere, link-column footer,
off-system font (Hanken Grotesk) and off-system accents (`#315F9B` blue,
`#3D806A` green). It reads generated.

The redesign: **the finished ad is the hero.** Blockwise's deliverable is a
polished Meta ad for a beautiful home — so the page shows exactly that, big.
Full-bleed property photography and large real ad renders alternate with
narrow, quiet text bands. Near-black ink on paper, Manrope headings, Inter
body, pill CTAs, one dark fold (the control dashboard), zero scroll reveals.
Look first, read second, one action: **Start free trial**.

One thing removed and why: the "signal → review" elbow-connector diagram and
the template-picker mock (tabs + 4 mini templates). They explained the product
by drawing a flowchart of it; the real ad renders now carry that story with
less to parse.

---

## 2. Hard constraints (violating any of these fails CI or repo rules)

Tests `tests/public-homepage.test.ts` and `tests/trial-onboarding-ui.test.ts`
pin the following. Verify each survives — run `npm run test` before calling
anything done.

### 2.1 `src/app/page.tsx` must
- NOT call `redirect(`.
- Keep `export const metadata` with `alternates: { canonical: "/" }` (exact
  formatting `alternates: { canonical: "/" }` — the test regexes it).
- Contain all ten section ids, **in this exact order**:
  `top, start, workflow, done-for-you, control, updates, property-check,
  free-trial, managed-setup, faq`. Each rendered once (`<section id="...">`).

### 2.2 Strings that MUST appear in the combined home-landing sources
(page.tsx + every `.ts`/`.tsx` file in `src/components/home-landing/`):
- `Your competitors are advertising. Are&nbsp;you?` (exact, with `&nbsp;`)
- `Ads built from what&rsquo;s actually working in your area. Start getting leads today.`
- `Know the property before the call`
- `Run a property check`
- `Nearby-ad examples show activity signals, not results.`
- `Nothing spends until you approve` · `Nothing spends before approval`
- `before and after approval` · `Approve every ad before it goes live`
- `SHELLEY, STEVEN JOHN` (footer legal line)
- `href="/signup"` · `href="#free-trial"` · `href="#managed-setup"` ·
  `location="faq_walkthrough"` · `SignInLink`

### 2.3 Strings that MUST NOT appear anywhere in those sources
- `href="#"` (dead anchor), `href="#signup"`
- Any of (case-insensitive): `Meta-compliant`, `guaranteed compliant`,
  `guaranteed leads`, `legal advice`, `full DA assessment`,
  `everything you need`, `council-approved`, `definitive`, `reach them first`,
  `ROI`, `Launch from Blockwise`, `publish the campaign`,
  `create, approve, launch`, `To launch from Blockwise`, `Auralis`
- Do not invent metrics, testimonials, logos, or customer counts. All demo
  numbers are the existing example data and every panel showing them keeps an
  explicit `Example` / `Example data` label.

### 2.4 Structural test rules
- Every `id="..."` in the combined sources must be unique (the managed-setup
  form generates its own ids — do not duplicate them).
- Every local anchor `href="#x"` must target an existing id.
- Every `src="/home/..."` must exist under `public/home/` (available files:
  `hero-map.webp`, `home-dusk.webp`, `home-pool.webp`, `interior-styled.webp`,
  `mt-lawley-federation.webp`, `open-home-living.webp`,
  `subiaco-townhouse.webp`).
- `managed-setup-form.tsx` is NOT modified: it keeps `name="company_website"`
  honeypot and the `hw-ms-hp` class, posts to `/api/demo-request`.

### 2.5 Repo rules (AGENTS.md / DESIGN.md)
- Invoke `$impeccable` and run `critique → distill → craft → layout → typeset
  → adapt → polish` (redesign workflow). Inspect the current page in the
  browser before editing. Report skills loaded, commands used, routes
  inspected, viewport sizes checked, remaining issues.
- One accent only (near-black ink). Semantic green/amber/red only for status
  meaning stated in text. No gradient text, no glassmorphism, no decorative
  hero metrics, no nested card shadows, no colored side-stripes.
- 44px minimum touch targets, complete interaction states, 150–250ms
  transitions, `prefers-reduced-motion` honored.
- Acceptance runs on a Vercel Preview URL, not localhost.

---

## 3. File plan

### Modify
| File | Change |
| --- | --- |
| `src/app/page.tsx` | New unified (single responsive tree) page; Manrope + Inter via `next/font/google`; remove Hanken Grotesk, remove `RevealObserver` and the `<noscript>` reveal fallback. Keep metadata. |
| `src/app/homepage.css` | Full rewrite. Hallmark stamp is the first line. All tokens + all section styles. |
| `src/components/home-landing/data.ts` | Edit per §5. |
| `tests/trial-onboarding-ui.test.ts` | Replace the hardcoded reads of `home-desktop.tsx` / `home-mobile.tsx` (L48–52) with a `readdirSync` loop over `src/components/home-landing/` (same pattern as `tests/public-homepage.test.ts` L11–18). |

### Create
| File | Contents |
| --- | --- |
| `src/components/home-landing/fb-ad-card.tsx` | Shared `FbAdCard` render of a finished Meta ad (§6.0). Server component. |
| `src/components/home-landing/site-chrome.tsx` | `SiteHeader` + `SiteFooter` (§6.1, §6.11). |
| `src/components/home-landing/home-sections.tsx` | All section components (§6.2–§6.10). Server components; no `"use client"`. |

### Delete (approved by this plan)
- `src/components/home-landing/home-desktop.tsx`
- `src/components/home-landing/home-mobile.tsx`
- `src/components/home-landing/mobile-hero-form.tsx`
- `src/components/home-landing/reveal-observer.tsx`

Delete only after the new tree renders and tests pass. Nothing else is
deleted. `public/home/hero-map.webp` becomes unused but stays on disk.

### Keep unchanged
`data.ts` consumers listed below, `faq-accordion.tsx` (pass
`withReveal={false}`), `managed-setup-form.tsx`, `suburb-report-location-form.tsx`,
`src/components/landing/cta-link.tsx`, `src/components/landing/sign-in-link.tsx`.
Do not touch `src/app/globals.css` or `src/app/landing.css`.

---

## 4. Tokens & base CSS (`src/app/homepage.css`)

First line of the file, verbatim:

```css
/* Hallmark · genre: modern-minimal · macrostructure: Photographic · theme: design-system (DESIGN.md, ink monochrome) · nav: N9 · footer: Ft5 · enrichment: none (real photography) · designed-as-app */
```

Then the token block. All colors come from DESIGN.md; **no other color values
may appear anywhere in the file** — if a value is needed, add it here first.

```css
.hw-page {
  /* ink & neutrals (DESIGN.md) */
  --hw-ink: #16181d;
  --hw-ink-strong: #0b0c10;
  --hw-press: #000000;
  --hw-tint: #f1f2f4;
  --hw-canvas: #f6f7f9;
  --hw-surface: #ffffff;
  --hw-muted: #545a66;
  --hw-faint: #9aa0ad;
  --hw-line: #e9ebef;
  --hw-line-heavy: #d3d7df;
  /* semantic (status text only) */
  --hw-success: #006d38;
  --hw-warning: #8a5a00;
  --hw-danger: #ba1a1a;
  /* dark-fold inverses */
  --hw-inv-text: #f6f7f9;
  --hw-inv-muted: rgba(246, 247, 249, 0.64);
  --hw-inv-line: rgba(246, 247, 249, 0.16);
  /* hero scrim */
  --hw-scrim: rgba(11, 12, 16, 0.55);
  --hw-scrim-soft: rgba(11, 12, 16, 0);
  /* type — families are set by next/font variables in page.tsx */
  --hw-font-display: var(--font-manrope), Inter, ui-sans-serif, system-ui, sans-serif;
  --hw-font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --hw-text-display: clamp(2.375rem, 4.5vw + 0.75rem, 4rem);   /* hero H1 */
  --hw-text-h2: clamp(1.625rem, 2.2vw + 0.6rem, 2.375rem);      /* section H2 */
  --hw-text-h3: 1.25rem;
  --hw-text-body: 0.9375rem;   /* 15px */
  --hw-text-lede: 1.0625rem;   /* 17px */
  --hw-text-label: 0.78125rem; /* 12.5px */
  --hw-text-caption: 0.8125rem;/* 13px */
  /* spacing (4pt) */
  --hw-space-2xs: 8px;  --hw-space-xs: 12px; --hw-space-sm: 16px;
  --hw-space-md: 24px;  --hw-space-lg: 32px; --hw-space-xl: 48px;
  --hw-space-2xl: 72px; --hw-space-3xl: 112px;
  /* radius (DESIGN.md) */
  --hw-r-control: 10px; --hw-r-card: 16px; --hw-r-panel: 20px; --hw-r-pill: 9999px;
  /* elevation (DESIGN.md) */
  --hw-shadow-rest: 0 1px 2px rgba(16, 18, 23, 0.04), 0 5px 18px rgba(16, 18, 23, 0.05);
  --hw-shadow-float: 0 10px 30px rgba(16, 18, 23, 0.09);
  --hw-focus-ring: 0 0 0 3px rgba(22, 24, 29, 0.14);
  /* motion */
  --hw-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --hw-dur: 200ms;
}
```

Base rules:
- `html, body { overflow-x: clip; }` (clip, never `hidden`).
- `.hw-page { background: var(--hw-canvas); color: var(--hw-ink); font-family: var(--hw-font-body); font-size: var(--hw-text-body); line-height: 1.5; }`
- Headings: `font-family: var(--hw-font-display); font-weight: 700; letter-spacing: -0.02em; line-height: 1.12; font-style: normal;` (H2s use `-0.01em`, line-height 1.15). **No italic anywhere in headings.**
- All display headings: `overflow-wrap: anywhere; min-width: 0;`.
- Image grids use `minmax(0, 1fr)` tracks, never bare `1fr`.
- `:focus-visible { outline: none; box-shadow: var(--hw-focus-ring); }` on all interactive elements; ring appears instantly (no transition on box-shadow for focus).
- `@media (prefers-reduced-motion: reduce) { .hw-page * { transition-duration: 0.01ms !important; animation: none !important; } }`

Buttons (used by retained components — these exact class names must exist):
- `.hw-btn` — pill (`--hw-r-pill`), height 44px, padding `0 20px`,
  `font-family: var(--hw-font-body); font-size: var(--hw-text-label);
  font-weight: 600;` inline-flex centered, gap 8px,
  `transition: background var(--hw-dur) var(--hw-ease), border-color var(--hw-dur) var(--hw-ease);`
  no transforms, no bounce.
- `.hw-btn--dark` — bg `--hw-ink`, text `--hw-surface`; hover bg `--hw-ink-strong`; active bg `--hw-press`; disabled: `opacity: .5; pointer-events: none`.
- `.hw-btn--light` — bg `--hw-surface`, text `--hw-ink` (used on dark fold); hover bg `--hw-tint`.
- `.hw-btn--outline` — bg transparent, `1px solid var(--hw-line-heavy)`, text `--hw-ink`; hover: border `--hw-ink`.
- `.hw-textlink` — ink text, 600 weight, underline offset 4px, no underline at rest, underline on hover; `.hw-arr` inherits.

Retained third-party class hooks that must stay styled (scoped overrides, as
today at homepage.css L60–75):
- `.hw-report-search .lp-location-form / .lp-location-pill / .lp-location-pill input / .lp-location-suggestions / .lp-location-option / .lp-location-powered / .lp-search-scope` — pill input 52px min-height, `--hw-surface` bg, `--hw-line-heavy` border, focus ring per token; suggestion list = floating surface (`--hw-shadow-float`, `--hw-r-control`).
- `.hw-report-search-note` — caption size, `--hw-muted` (over photo: `--hw-inv-muted`).
- `.hw-report-search-error` — `--hw-danger`.
- `.hw-ms-form / .hw-ms-row / .hw-ms-error / .hw-ms-actions / .hw-ms-submit / .hw-ms-success-h / .hw-ms-success-b / .hw-ms-hp` — form card per §6.9; `.hw-ms-hp { position: absolute; left: -9999px; }` stays visually hidden. Also keep minimal styles for `.hwm-ms-form / .hwm-ms-error / .hwm-ms-submit / .hwm-ms-fineprint` (the component's mobile variant, unused but must not render broken if reused).
- FAQ classes per §6.10.

Layout primitives:
- `.hw-band` — narrow text band: `max-width: 720px; margin-inline: auto; padding: var(--hw-space-3xl) var(--hw-space-md);` (mobile: `padding: var(--hw-space-2xl) var(--hw-space-sm)`).
- `.hw-wide` — content band: `max-width: 1200px; margin-inline: auto; padding-inline: var(--hw-space-md);`.
- `.hw-fold` — full-bleed: `width: 100%;`.
- Single breakpoint set: 640px and 960px. Below 960px all multi-column grids collapse to one column.

---

## 5. `data.ts` changes

1. Delete exports: `STUCK_TASKS`, `DASH_TILES`, `CHART_POINTS_MOBILE`.
2. Rename `CHART_POINTS_DESKTOP` → `CHART_POINTS`.
3. In `DASH_ROWS`, replace `statusColor: "#3D806A"` / `"#8B97A5"` with
   `tone: "active"` (for Active rows) and `tone: "quiet"` (Paused/Draft).
   The component maps `active` → `color: var(--hw-success)` and `quiet` →
   `color: var(--hw-inv-muted)`.
4. Keep unchanged: `FAQ_DATA`, `HERO_RAIL`, `RADAR_ADS`, `PROPERTY_USES`,
   `PROPERTY_NOTES`. Update the file's top comment to say copy is preserved
   from the previous build and remains final.

---

## 6. Section-by-section spec

General rules for all sections:
- No `data-reveal` attributes anywhere. No IntersectionObserver. Content is
  visible immediately.
- Exactly ONE eyebrow/kicker on the whole page (hero, §6.2). Every other
  section leads directly with its H2. Never place a label left of a heading.
- All copy below is verbatim and final — do not rewrite, "improve", or extend.
- `CtaLink` (from `@/components/landing/cta-link`) is used for every marketing
  CTA with the exact `location` strings given; `SignInLink` for sign-in.

### 6.0 `FbAdCard` (shared component, `fb-ad-card.tsx`)

A quiet, realistic render of a finished Meta feed ad. Props:
`{ copy: string; photoSrc: string; photoAlt?: string; domain: string;
footHeading: string; footSub?: string; }`.

Markup (classes exact):

```tsx
<figure className="hw-fbad">
  <div className="hw-fbad-head">
    <span className="hw-fbad-avatar" aria-hidden>YA</span>
    <span className="hw-fbad-id">
      <span className="hw-fbad-agency">Your Agency</span>
      <span className="hw-fbad-sponsored">Sponsored</span>
    </span>
  </div>
  <p className="hw-fbad-copy">{copy}</p>
  <div className="hw-fbad-photo"><img src={photoSrc} alt={photoAlt ?? ""} /></div>
  <div className="hw-fbad-foot">
    <span className="hw-fbad-foot-l">
      <span className="hw-fbad-domain">{domain}</span>
      <span className="hw-fbad-foot-h">{footHeading}</span>
      {footSub ? <span className="hw-fbad-foot-sub">{footSub}</span> : null}
    </span>
    <span className="hw-fbad-btn">Learn more</span>
  </div>
</figure>
```

Style: `--hw-surface` bg, `--hw-r-card` radius, `1px solid var(--hw-line)`,
`--hw-shadow-rest`. Avatar: 36px circle, `--hw-ink` bg, `--hw-surface` text,
11px 700. Photo: `aspect-ratio: 4 / 3; object-fit: cover; width: 100%`.
Domain: 10.5px uppercase `--hw-faint` letter-spacing 0.06em. Foot heading 600.
`.hw-fbad-btn` — small `--hw-tint` pill, ink label (static, not a link).
The card is a product render, not a clickable element.

### 6.1 `SiteHeader` (N9 edge-aligned minimal) — in `site-chrome.tsx`

Static (not fixed/sticky), `--hw-canvas` bg, hairline bottom
(`1px solid var(--hw-line)`), inner `.hw-wide` row, height 64px:
- Left: `<a href="#top" className="hw-logo">` — 8px square ink mark
  (`.hw-logo-mark`) + wordmark `blockwise` (Manrope 700, 17px,
  letter-spacing -0.01em).
- Right (desktop ≥960px): nav links `How it works`→`#start`,
  `Property Check`→`#property-check`, `Pricing`→`/pricing` (next/link),
  `Guides`→`/guides` (next/link) — Inter 600 12.5px `--hw-muted`, hover
  `--hw-ink`; then `<SignInLink className="hw-login" />`; then
  `<CtaLink location="header" href="/signup" className="hw-btn hw-btn--dark">Start free trial</CtaLink>`.
- Below 960px: hide the four nav links (`display: none`), keep logo + Sign in
  + CTA. No hamburger. CTA stays one line (`white-space: nowrap`).

### 6.2 `#top` — Hero (photographic fold)

Full-bleed fold, `min-height: min(92svh, 860px)` desktop / `min-height: auto`
mobile. Background: `home-dusk.webp` via `<img>` absolutely positioned,
`object-fit: cover`, `object-position: center`, with left scrim overlay
`linear-gradient(90deg, var(--hw-scrim) 0%, var(--hw-scrim) 36%, var(--hw-scrim-soft) 72%)`
(mobile: bottom-up gradient, text over lower third).

Content grid (`.hw-wide`, two columns `minmax(0,1fr) 400px`, gap
`--hw-space-2xl`, vertically centered; below 960px single column):

Left column (text on scrim, `--hw-inv-text`):
1. Eyebrow `.hw-eyebrow`: `Meta ads for real estate agents` — 12px, 600,
   uppercase off — sentence case, letter-spacing 0.02em, `--hw-inv-muted`.
2. `<h1 className="hw-h1">Your competitors are advertising. Are&nbsp;you?</h1>`
   — `--hw-text-display`, `--hw-inv-text`, max-width 15ch.
3. Lede `.hw-lede`:
   `Ads built from what&rsquo;s actually working in your area. Start getting leads today.`
   — `--hw-text-lede`, `--hw-inv-muted`, max-width 44ch.
4. `<SuburbReportLocationForm analyticsLocation="hero" />` inside
   `.hw-hero-form` (max-width 440px). Note text renders in `--hw-inv-muted`.
5. Plate caption `.hw-plate` (bottom-left of the fold, absolutely positioned
   at desktop; in-flow last on mobile): `Mt Lawley, WA · Seller-lead ad ·
   Example` — 13px, `--hw-inv-muted`.

Right column (desktop only ≥960px; on mobile it renders below the fold on
canvas, inside the same section):
`.hw-hero-review` — a slim frame around an `FbAdCard`:
- Status row: `.hw-status`: 8px `--hw-success` dot + `Ready to review`
  (12.5px 600 `--hw-inv-text` on desktop overlay / `--hw-ink` on mobile).
- `<FbAdCard copy="Thinking of selling? Find out what your home could be worth with a free property appraisal." photoSrc="/home/interior-styled.webp" domain="YOURAGENCY.COM.AU" footHeading="Find out what your home could be worth" footSub="Book a free property appraisal" />`
- Note `.hw-note`: `Nothing spends until you approve.` — 12.5px,
  `--hw-inv-muted` desktop / `--hw-muted` mobile.

### 6.3 `#start` — The ads near you (photographic band)

On canvas. `.hw-band` text head (left-aligned):
- `<h2>Don&rsquo;t start from a blank page.</h2>`
- Lede (`--hw-muted`, max 60ch): `Choose a proven template or use an ad
  approach already working in the market. Blockwise adapts it to your listing
  and brand.`

Then `.hw-wide` ad row `.hw-adrow`: the three `RADAR_ADS` as **large**
`FbAdCard`s — grid `repeat(3, minmax(0, 1fr))`, gap `--hw-space-md`. Below
960px: horizontal scroll-snap row (`overflow-x: auto; scroll-snap-type: x
mandatory;` cards `min-width: 82%; scroll-snap-align: center;` with
`scrollbar-width: none`). Map fields: `copy` → copy, `src` → photoSrc,
`"YOURAGENCY.COM.AU"` → domain, `foot` → footHeading. Under each card a
caption `.hw-adrow-caption`: the `angle` value (`Free appraisal` ·
`Just listed` · `Open home`) — 13px `--hw-faint`.

Close of section, `.hw-band` (top padding `--hw-space-xl` only):
- `<CtaLink location="signal_review" href="/signup" className="hw-btn hw-btn--dark">Create my ad</CtaLink>`
- `.hw-note`: `Nothing spends until you approve.`
- Disclaimer `.hw-disclaimer` (13px `--hw-faint`): `Nearby-ad examples show
  activity signals, not results. What runs is always your call.`

### 6.4 `#workflow` — Text band (kept for anchor contract)

Pure narrow text band (`.hw-band`), no imagery, no cards:
- `<h2>Too much time is wasted on ads. Not enough time is spent with clients.</h2>`
- Body (`--hw-muted`): `Blockwise handles the setup, creative, approvals and
  updates so agents can stay out of Ads Manager.`
- `<CtaLink location="workflow" href="/signup" className="hw-textlink">Get your first ad prepared <span className="hw-arr">→</span></CtaLink>`

### 6.5 `#done-for-you` — Prepared. Checked. Sent.

`--hw-surface` fold (full-width white band, hairline top+bottom). Inner
`.hw-wide` split grid `440px minmax(0, 1fr)`, gap `--hw-space-2xl`
(single column below 960px, text first).

Left rail:
- `<h2>Prepared.<br />Checked.<br />Sent.</h2>`
- Sub (`--hw-muted`): `One approval replaces the setup work.`
- Spec list `.hw-spec` from `HERO_RAIL` — each row: key (12.5px 600
  `--hw-faint`) left, value (14px 600 `--hw-ink`) right, hairline between rows
  (tabular, quiet — no cards).
- `<CtaLink location="done_for_you_approve" href="/signup" className="hw-btn hw-btn--dark">Approve</CtaLink>`
- `.hw-note`: `Nothing spends before approval.`

Right: `.hw-dfy-ad` — status row (`--hw-success` dot +
`Seller lead ad · Ready for review`, 12.5px 600) above a large `FbAdCard`
(max-width 560px):
`copy="Wondering what your home is worth? Book a free, no-obligation appraisal this week."
photoSrc="/home/mt-lawley-federation.webp" domain="youragency.com"
footHeading="Free home appraisal" footSub="Local experts. No obligation."`

### 6.6 `#control` — The dark fold

Full-bleed `--hw-ink` background fold, text `--hw-inv-text`, padding block
`--hw-space-3xl`. Inner `.hw-wide` grid `380px minmax(0, 1fr)`, gap
`--hw-space-2xl` (single column below 960px).

Left rail:
- `<h2>You stay in control before and after approval.</h2>`
- Sub (`--hw-inv-muted`): `Review what goes live, then track spend, leads and
  status from one clean dashboard.`
- `CONTROL_POINTS` list — each row: `✓` in `--hw-inv-muted` + point text
  (14px, `--hw-inv-text`). (Contains the pinned string
  `Approve every ad before it goes live`.)

Right: `.hw-dash` panel — `1px solid var(--hw-inv-line)`, radius
`--hw-r-panel`, transparent bg:
- Head row: `Control dashboard` (16px 700) over
  `Every ad in one place · Example data` (12.5px `--hw-inv-muted`); right:
  `<CtaLink location="control_dashboard" href="/signup" className="hw-btn hw-btn--light">Create ad</CtaLink>`
- Chart block: label row `Leads · last 14 days` / `Mt Lawley appraisal`
  (12.5px `--hw-inv-muted`), then the SVG polyline from `CHART_POINTS`
  (`viewBox="0 0 560 90"`, `preserveAspectRatio="none"`, `aria-hidden`),
  stroke `#f6f7f9` at `stroke-opacity="0.9"` width 1.5, baseline hairline
  stroke `--hw-inv-line`. **No draw-in animation.**
- Table: header `Ad · Status · Clicks · Leads · Spend` (11px uppercase
  `--hw-inv-muted`), rows from `DASH_ROWS` — name (14px 600) + sub (12.5px
  `--hw-inv-muted`); status = dot + label colored by `tone` (§5.3); numbers
  right-aligned `font-variant-numeric: tabular-nums`. Row grid
  `minmax(0,2fr) minmax(0,1fr) repeat(3, minmax(0,0.7fr))`, hairline
  separators `--hw-inv-line`. Below 640px hide the Clicks column
  (`display: none` on 3rd data cell + header cell).

### 6.7 `#updates` — Daily email band

On canvas, `.hw-band` head + one card. Head:
- `<h2>Updates where agents actually check.</h2>`
- Sub (`--hw-muted`): `Open Blockwise for the detail. Get the short version by email.`

Card `.hw-email` (max-width 560px, surface, `--hw-r-card`, hairline,
`--hw-shadow-rest`):
- Head row: `Daily email` (600) + tag `Optional` (`.hw-tag`: `--hw-tint` pill,
  11px 600 `--hw-muted`).
- `Your ads yesterday` (16px 700).
- Three stats inline (`.hw-email-stats`, grid 3 × `minmax(0,1fr)`): `6` /
  `New leads`, `$41` / `Spend`, `118` / `Clicks` — value 22px Manrope 700,
  key 12.5px `--hw-muted`.
- Three status lines, each `dot + text` (dot 7px circle):
  `--hw-success` dot `Free appraisal ad is live.` ·
  `--hw-warning` dot `Market update ad needs approval.` ·
  `--hw-faint` dot `No Ads Manager login needed.`

### 6.8 `#property-check` — Tinted split band

Full-width `--hw-tint` band. Inner `.hw-wide` grid
`minmax(0,1fr) minmax(0,1fr)`, gap `--hw-space-2xl` (single column <960px).

Left:
- `<h2>Know the property before the call</h2>`
- Sub (`--hw-muted`): `Check zoning, overlays, subdivision potential,
  renovation limits, and planning red flags before speaking to a seller,
  buyer, or investor.`
- `PROPERTY_USES` — three rows: title (14px 600) + body (14px `--hw-muted`),
  hairline-separated, no cards.
- `<CtaLink location="property_check" href="/signup?source=property-check" className="hw-textlink">Run a property check <span className="hw-arr">→</span></CtaLink>`

Right panel `.hw-pc-panel` (surface, `--hw-r-panel`, hairline,
`--hw-shadow-rest`, padding `--hw-space-md`):
- Head: `14 Sample St, Mt Lawley WA` (600) + `.hw-tag` `Example`; right
  `Check complete` (12.5px 600 `--hw-success`).
- Facts grid 3 × `minmax(0,1fr)`: `Zoning`→`R20 / R40`,
  `Overlays`→`Heritage area`, `Subdivision`→`Potential — verify lot width`
  (this value in `--hw-warning` — it is a review-required state).
- `PROPERTY_NOTES` list — dot + text + ` — {source}` in `--hw-faint`.
- Foot (12.5px `--hw-faint`): `Source-cited notes for call prep. Always
  confirm with the local planning authority.`

### 6.9 `#free-trial` + `#managed-setup`

`#free-trial` — statement band on canvas (`.hw-band`, but `max-width: 880px`):
- `<h2>Try Blockwise free for 7 days.</h2>`
- Sub (`--hw-muted`): `No card required. Review your ads and connect your ad
  account when you are ready for final setup.`
- `<CtaLink location="free_trial" href="/signup" className="hw-btn hw-btn--dark">Start free trial <span className="hw-arr">→</span></CtaLink>`
- Facts row (grid 3 × `minmax(0,1fr)`, gap `--hw-space-md`; single column
  <640px): `7 days` / `Full access from the minute you confirm your email.` ·
  `No card` / `Nothing charges when the trial ends. Your drafts stay put.` ·
  `Connect anytime` / `Connect your Meta ad account when you are ready.` —
  heading 16px Manrope 700, body 14px `--hw-muted`. No cards, hairline top
  border on each cell.

`#managed-setup` — surface band (white, hairline top+bottom). Inner `.hw-wide`
grid `minmax(0,1fr) 480px` (single column <960px):
- Left: `<h2>Want help getting started?</h2>`; sub (`--hw-muted`): `Book a
  15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
  account and review everything before handoff.`; three ✓ rows: `First ads
  set up with you` · `Ad account connected` · `Everything reviewed before
  handoff`.
- Right: `<ManagedSetupForm idPrefix="ms" variant="desktop" />` — style
  `.hw-ms-form` as a surface card (`--hw-r-panel`, hairline,
  `--hw-shadow-rest`, padding `--hw-space-md`); inputs 44px min-height,
  `--hw-r-control`, `--hw-line-heavy` border, labels outside values; error
  text `--hw-danger`; submit uses existing `hw-btn hw-btn--dark`. Make
  `.hw-ms-row` stack below 640px.

### 6.10 `#faq`

`.hw-band`:
- `<h2>The bits agents ask about.</h2>`
- `<FaqAccordion idPrefix="faq-d" withReveal={false} />` — style:
  `.hw-faq-item` hairline-separated rows (no cards); `.hw-faq-q` full-width
  button, 15px 600, 44px min-height, padding block 16px; `.hw-faq-icon`
  rotates 45° when open (`transition: transform var(--hw-dur) var(--hw-ease)`);
  `.hw-faq-body` uses `display: grid; grid-template-rows: 0fr → 1fr;
  transition: grid-template-rows var(--hw-dur) var(--hw-ease);` with
  `.hw-faq-body-clip { overflow: hidden; min-height: 0; }`; `.hw-faq-a` 14px
  `--hw-muted`, max 70ch. (Check `faq-accordion.tsx` for how open state is
  applied and style accordingly — do not modify the component.)
- Banner `.hw-faq-banner` (tint bg, `--hw-r-card`, padding `--hw-space-md`,
  row split; stacks <640px): `Need a hand getting started?` (600) + `Book a
  15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
  account and get everything ready for final setup.` (14px `--hw-muted`) +
  `<CtaLink location="faq_walkthrough" href="#managed-setup" className="hw-textlink">Book a walkthrough <span className="hw-arr">→</span></CtaLink>`

### 6.11 `SiteFooter` (Ft5 Statement) — in `site-chrome.tsx`

Full-bleed `--hw-ink` fold, `--hw-inv-text`:
- Statement block (padding block `--hw-space-3xl`, `.hw-wide`):
  `<p className="hw-footer-statement">Your competitors are advertising. Are you?</p>`
  — `--hw-text-h2` size, Manrope 700; beneath it
  `<CtaLink location="footer" href="/signup" className="hw-btn hw-btn--light">Start free trial <span className="hw-arr">→</span></CtaLink>`.
- Hairline rule (`--hw-inv-line`), then one link row (`.hw-footer-links`,
  flex-wrap, gap 20px, 12.5px 600, `--hw-inv-muted`, hover `--hw-inv-text`):
  `How it works`→`#start` · `Property Check`→`#property-check` ·
  `Free trial`→`#free-trial` · `Pricing`→`/pricing` · `Guides`→`/guides` ·
  `Privacy`→`/privacy` · `Terms`→`/terms` · `Data deletion`→`/data-deletion` ·
  `hello@blockwise.sale`→`mailto:hello@blockwise.sale`.
- Legal line (12px, `--hw-inv-muted`):
  `© 2026 Blockwise. All rights reserved. Blockwise is operated by SHELLEY, STEVEN JOHN.`
- Wordmark small at the left of the link row: mark + `blockwise`.

---

## 7. `src/app/page.tsx` skeleton

```tsx
import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";

import { FbAdCard } from "@/components/home-landing/fb-ad-card"; // if needed here
import {
  ControlFold, DoneForYou, FaqSection, FreeTrial, Hero, ManagedSetup,
  PropertyCheck, StartBand, Updates, WorkflowBand,
} from "@/components/home-landing/home-sections";
import { SiteFooter, SiteHeader } from "@/components/home-landing/site-chrome";

import "./homepage.css";

const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <div className={`hw-page ${manrope.variable} ${inter.variable}`}>
      <SiteHeader />
      <main>
        <section id="top"><Hero /></section>
        <section id="start"><StartBand /></section>
        <section id="workflow"><WorkflowBand /></section>
        <section id="done-for-you"><DoneForYou /></section>
        <section id="control"><ControlFold /></section>
        <section id="updates"><Updates /></section>
        <section id="property-check"><PropertyCheck /></section>
        <section id="free-trial"><FreeTrial /></section>
        <section id="managed-setup"><ManagedSetup /></section>
        <section id="faq"><FaqSection /></section>
      </main>
      <SiteFooter />
    </div>
  );
}
```

No `RevealObserver`, no `<noscript>` block, no Hanken Grotesk.

---

## 8. Motion & accessibility

- Zero scroll-triggered animation. Zero entrance animation. The page is
  composed at rest.
- Only transitions: button/link/tab hover-active (150–250ms, `--hw-ease`),
  FAQ open/close, input focus. Animate opacity/color/transform only — never
  layout properties (the FAQ grid-rows trick is the one exception, matching
  the existing component).
- Focus ring on every interactive element, shown instantly.
- Landmarks: one `<header>`, one `<main>`, one `<footer>`; one `<h1>` (hero);
  every section heading is `<h2>`.
- All decorative images `alt=""` + `aria-hidden` where appropriate; the hero
  background img gets `alt=""` and `fetchpriority="high"`; all below-fold
  imgs get `loading="lazy"`.
- Text over photo must meet 4.5:1 — the scrim guarantees it; do not weaken
  the scrim values.
- No two-line buttons or nav links at 320px (`white-space: nowrap` on
  `.hw-btn`; verify).

---

## 9. Project memory (Hallmark)

After the build, create `.hallmark/log.json` at the repo root:

```json
[
  {
    "date": "<build date YYYY-MM-DD>",
    "scope": "page",
    "macrostructure": "Photographic",
    "theme": "design-system (DESIGN.md ink monochrome)",
    "enrichment": "none",
    "nav": "N9",
    "footer": "Ft5",
    "brief": "Blockwise homepage redesign - luxury photographic, real ad renders"
  }
]
```

Add `.hallmark/` to `.gitignore` ONLY if `.gitignore` doesn't already cover
it; otherwise commit the log with the change.

---

## 10. Execution order & verification

1. **Impeccable gate**: invoke `$impeccable`; run `critique` + `distill`
   against the live current homepage in the browser (Vercel prod or local
   dev) at 1440px and 375px. Note findings, then build.
2. Write `fb-ad-card.tsx`, `site-chrome.tsx`, `home-sections.tsx`, update
   `data.ts`.
3. Rewrite `src/app/page.tsx`, rewrite `src/app/homepage.css`.
4. Update `tests/trial-onboarding-ui.test.ts` file list (§3).
5. Delete the four old files (§3). Search the repo for any remaining imports
   of them (`home-desktop`, `home-mobile`, `mobile-hero-form`,
   `reveal-observer`) — must be zero.
6. `npm run typecheck` — pass. `npm run test` — pass (pay attention to
   `public-homepage.test.ts` and `trial-onboarding-ui.test.ts`).
7. `npm run build` — pass.
8. Browser verification (Chrome) at **320, 375, 414, 768, 1440** widths:
   - no horizontal scroll at any width;
   - hero photo + scrim text legible at all widths;
   - `#start` cards scroll-snap on mobile, 3-up on desktop;
   - every nav/footer anchor scrolls to its section;
   - suburb form submits (type `Mt Lawley` → navigates to `/suburb/...`);
   - FAQ opens/closes; managed-setup form validates + posts;
   - keyboard-tab through the whole page — visible focus everywhere.
9. Run the Hallmark slop-test pass mentally against
   `.agents/skills/hallmark/references/slop-test.md` highlights: no gradient
   text, no glass, no invented metrics (all example data labeled), one accent,
   no italic headings, no eyebrow-left-of-heading, roman display only.
10. `$impeccable` closing pass: `adapt` (mobile), `polish` (spacing/hairline
    consistency, tabular numerals in the dashboard), `harden` (states).
11. Deploy to **Vercel Preview** and re-verify desktop + mobile there.
    Localhost is not acceptance (AGENTS.md).
12. Report per AGENTS.md: skills loaded, Impeccable commands used, routes
    inspected, viewports checked, remaining issues. Run the cleanup skill
    (`hermes/skills/blockwise-agent-cleanup/SKILL.md`); commit + push + PR the
    change (release work is pre-authorized; log decisions in the PR
    description).

## 11. Out of scope

- `/pricing`, `/guides`, `/suburb/*`, auth pages, app surfaces — untouched.
- No new imagery generation; only the seven existing `public/home/*.webp`.
- No copy rewrites beyond assembling the verbatim strings in §6.
- No changes to `DESIGN.md`, `globals.css`, `landing.css`, analytics libs,
  or the demo-request API.
