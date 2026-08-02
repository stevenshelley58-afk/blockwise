# Mobile dashboards — build spec

**Status:** approved for build
**Author:** planning pass, 2026-07-28
**Baseline:** `origin/main` @ `2715f80` (= production)
**Branch to create:** `feat/mobile-dashboards`
**Mockups:** the approved before/after sheet (`blockwise-mobile-mockups` artifact). Where this spec and the mockup disagree, **this spec wins** — deviations are called out in §12.

---

## 0. Read this before touching anything

You are implementing six mobile-layout changes plus one new component. Everything below is written against `origin/main`. Follow it literally.

### 0.1 Hard rules

1. **Branch from `origin/main`, not from whatever is checked out.** The working copy on the owner's machine sits on `feat/bold-outline-home`, five commits behind `main`, with a large dirty tree containing an unrelated Premium-v2 Ad Studio experiment. If you branch from `HEAD` you will be editing the *pre-Premium-v2* customer surface — different files, different classes, wasted work. See §1.
2. **Never revert, stash, delete, or commit the owner's existing dirty files.** Work only on files this spec names.
3. **Do not create a parallel design system.** Every value you write must already exist as a token or a class used elsewhere in the customer surface (`--r-card`, `--line`, `shadow-card`, `font-display`, `font-mono`, …). No new colours, no new radii, no new fonts.
4. **Do not touch the Ad Studio template pipeline.** `buildCloneImageRequest`, the gallery JSON under `src/lib/adstudio/template-gallery/`, and `scripts/verify/adstudio-templates.mjs` are out of scope. Task 8 is presentation-only.
5. **Localhost is never acceptance** (AGENTS.md). Localhost is fine for *diagnosis*. Acceptance happens on a Vercel Preview URL.
6. **Task 1 is a diagnosis task and it gates Task 9.** If Task 1's measurement does not confirm the predicted cause, **stop and report** instead of applying the predicted fix.
7. **`$impeccable` is mandatory** for this work (AGENTS.md, "Mandatory UI workflow"). See §11 for the exact commands to invoke and the report you owe at the end.

### 0.2 Files you will create

| Path | Purpose |
|---|---|
| `src/lib/research/brand-pack-suburb.ts` | Pure address → suburb/postcode parser |
| `src/components/research/meta-ad-tile.tsx` | Compact 2-up Ad Radar tile (mobile) |
| `src/components/ui/creative-viewer.tsx` | Shared fullscreen creative overlay |
| `tests/brand-pack-suburb.test.ts` | Unit tests for the parser |

### 0.3 Files you will edit

| Path | Task |
|---|---|
| `src/components/ui/sidebar.tsx` | 1 |
| `src/components/leads/lead-stats.tsx` | 2 |
| `src/config/niche/blockwise/leads.ts` | 2 |
| `src/components/research/ad-radar-location-form.tsx` | 3 |
| `src/components/research/ad-radar-search-panel.tsx` | 3, 4, 5, 6 |
| `src/app/(customer)/ad-radar/page.tsx` | 5 |
| `src/components/research/ad-radar-results-grid.tsx` | 6 |
| `src/config/niche/niche.ts` | 7, 9 |
| `src/config/niche/blockwise.ts` | 7 |
| `src/config/niche/blockwise/performance.ts` | 9 |
| `src/components/self-serve-shell.tsx` | 7 |
| `src/components/adstudio/new-ad-dialog.tsx` | 8 |
| `src/components/monitor/MetaMonitorHeader.tsx` | 9 |
| `src/components/monitor/MetaKpiCard.tsx` | 9 |
| `src/components/monitor/MetaMonitorDashboard.tsx` | 1, 9 |

### 0.4 Files you must NOT edit

- `src/components/app/mobile-bottom-nav.tsx` — that is the **operator/monitor** bottom nav, a different shell variant. Task 7 is self-serve only.
- `src/components/research/meta-ad-library-card.tsx` — the full desktop card stays exactly as-is. The mobile tile is a *new sibling component*.
- Anything under `src/lib/adstudio/template-gallery/`, `hermes/`, `supabase/migrations/`.

---

## 1. Task 0 — Environment and baseline

```bash
git fetch origin
git checkout -b feat/mobile-dashboards origin/main
npm install
```

Then, **before editing anything**, capture a clean baseline:

```bash
npm run check          # check:nul + test + typecheck
npm run verify:hard-reset
```

Both must pass. Record the test count (expected: 933 passing at `bcfe63c`). If either fails on a clean `origin/main`, stop and report — you cannot distinguish your regressions from pre-existing ones otherwise.

Per AGENTS.md: run `codegraph_status` and `codegraph sync` if stale.

---

## 2. Task 1 — Diagnose the `/results` horizontal overflow (BLOCKING)

### 2.1 The symptom

On a ~390 px viewport, `/results` shows one visible column of KPI tiles: Reach, Link clicks, Leads. The code renders `grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-6` with six tiles in the order Reach, Impressions, Link clicks, CTR, Leads, Spend. Reach / Link clicks / Leads are items **1, 3 and 5** — i.e. column one of a two-column grid. Column two is rendered off-screen to the right.

**Therefore this is not a grid-columns bug. It is a horizontal-overflow bug.** Do not "fix" it by changing `grid-cols-2`.

### 2.2 The prediction (to confirm or refute)

`SidebarInset` in `src/components/ui/sidebar.tsx` is:

```tsx
className={cn(
  "relative flex w-full flex-1 flex-col bg-background",
  ...
)}
```

It is a flex item with no `min-w-0`, so its automatic minimum size resolves to `min-content`. If any descendant contributes a large min-content width, the `<main>` grows past the viewport and `w-full` cannot stop it. The campaigns table on `/results` is `<Table className="min-w-[820px]">`. 820 px ≈ the width the screenshot implies.

### 2.3 The measurement (do this first, before any edit)

Run the app locally (`npm run dev`) and execute this Playwright script. Chromium is preinstalled; do **not** run `playwright install`.

```js
// scripts/tmp/measure-results-overflow.mjs  (delete before PR)
import { chromium } from "playwright";

const url = process.env.TARGET_URL ?? "http://localhost:3000/results";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// Authenticate however the local seed users work (see scripts/seed-test-users.mjs).
await page.goto(url, { waitUntil: "networkidle" });

const report = await page.evaluate(() => {
  const de = document.scrollingElement;
  const overflowing = [...document.querySelectorAll("*")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.right > window.innerWidth + 1 || r.width > window.innerWidth + 1)
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      slot: el.getAttribute("data-slot") ?? "",
      cls: String(el.className).slice(0, 140),
      width: Math.round(r.width),
      right: Math.round(r.right),
    }));
  return { innerWidth: window.innerWidth, scrollWidth: de.scrollWidth, count: overflowing.length, overflowing: overflowing.slice(0, 40) };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
```

### 2.4 Decision gate

- **`scrollWidth === innerWidth`** → there is no overflow; the screenshot was a pinch-zoom artefact. **Stop. Report. Skip Task 9's overflow fix** and do the polish half of Task 9 only.
- **Overflow confirmed AND `<main data-slot="sidebar-inset">` is in the offender list** → apply §2.5.
- **Overflow confirmed but the offender is something else** → **stop and report the offender chain.** Do not guess a fix.

### 2.5 The fix (only after confirmation)

**`src/components/ui/sidebar.tsx`** — in `SidebarInset`:

```diff
-        "relative flex w-full flex-1 flex-col bg-background",
+        "relative flex w-full min-w-0 flex-1 flex-col overflow-x-clip bg-background",
```

**`src/components/monitor/MetaMonitorDashboard.tsx`** — the `Dashboard` root container:

```diff
-    <div className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
+    <div className="mx-auto grid w-full min-w-0 max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
```

`min-w-0` is the fix; `overflow-x-clip` is the guard. Both are standard Tailwind, no token impact.

**Regression risk:** `SidebarInset` is shared by the self-serve shell *and* Ad Studio. After this change, re-measure **`/self-serve`, `/leads`, `/ad-radar`, `/settings`, `/ad-studio`** at 390 px with the same script. Every one must report `scrollWidth === innerWidth`, and no page may have gained a clipped element that was previously reachable by horizontal scroll. The campaigns table keeps its own `overflow-x-auto` wrapper, so it must still scroll horizontally inside its panel — verify by dragging it.

---

## 3. Task 2 — Leads stat tiles go 2-up

### 3.1 `src/components/leads/lead-stats.tsx`

```diff
-    <AnimatedGroup className="grid gap-3.5 sm:grid-cols-3" itemClassName="h-full">
+    <AnimatedGroup className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-3.5" itemClassName="h-full">
```

That is the only change to this file. Tile internals — mono micro-label, `AnimatedNumber` count-up, `font-display text-[24px] font-extrabold` — stay exactly as they are.

The third tile lands at half width on the second row with the right half empty. **This is intended** (owner's explicit choice). Do not add a `col-span-2`, do not centre it, do not reflow it.

### 3.2 `src/config/niche/blockwise/leads.ts`

```diff
-    duplicates: "Duplicates flagged",
+    duplicates: "Duplicates",
```

"Duplicates flagged" overflows the mono micro-label onto two lines at half width. The explanatory note underneath (`duplicatesNote: "Matched by email or phone"`) is unchanged and carries the meaning.

**Before changing it, confirm nothing asserts the old string:**

```bash
git grep -n "Duplicates flagged" -- src tests e2e scripts
```

Expected: only `src/config/niche/blockwise/leads.ts` and `mockups/dashboard-premium-v2.html` (a static reference mockup, not code — leave it alone). If a test matches it, update that test deliberately and say so in the PR.

### 3.3 Acceptance

At 390 px on `/leads`: two tiles on row one, one tile on row two, no horizontal scroll, no label wrapping to two lines, the empty state visible without scrolling.

---

## 4. Task 3 — Ad Radar search field starts empty, helper line goes

### 4.1 Stop pre-filling the input

**`src/components/research/ad-radar-search-panel.tsx`**, inside `<AdRadarLocationForm …>`:

```diff
-          initialValue={initialQuery || initialLocationLabel}
+          initialValue={initialQuery}
```

`initialLocationLabel` is still a prop and is still used — by the results heading (`Ads near ${initialLocationLabel}`) and by Task 5's auto-load. **Do not delete the prop.**

### 4.2 Hide the scope sentence on the research surface

**`src/components/research/ad-radar-location-form.tsx`** — the scope paragraph near the end of the form:

```diff
       <p
         id={`${listId}-scope`}
-        className={isLanding ? "lp-search-scope" : "basis-full text-[11.5px] text-(--faint)"}
+        className={isLanding ? "lp-search-scope" : "sr-only"}
       >
         {niche.copy.adRadar.searchScope}
       </p>
```

**Why `sr-only` and not deletion — read this, it matters:**

1. The element is the `aria-describedby` target of the combobox input. Deleting it breaks the accessible description.
2. `tests/ad-radar-search-suggestions.test.ts` asserts the form source matches `/niche\.copy\.adRadar\.searchScope/`. Deleting the reference **fails that test**.
3. The landing-page surface (`surface="landing"`) still shows the sentence visually and must keep doing so.

So: visually gone on the research surface, still announced by screen readers, still referenced in source, landing untouched. Do not "simplify" this.

### 4.3 Acceptance

`/ad-radar` at 390 px: input shows grey placeholder text `Postcode, suburb, agency, or agent`, not `Perth, WA`. No visible sentence under the input. `npm run test` still green.

---

## 5. Task 4 — Ad Radar controls collapse to two rows

### 5.1 Replace the filter row

**`src/components/research/ad-radar-search-panel.tsx`.** Find the block that currently starts:

```tsx
<div className="flex flex-wrap items-center gap-2.5 border-t border-(--line) pt-4">
```

…and ends with the closing `</div>` after the sort `role="group"` block, plus the separate freshness line lower down:

```tsx
<div className="flex items-center gap-1.5 text-[11.5px] text-(--faint)">
  <Clock3 size={13} aria-hidden />
  {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
</div>
```

Replace **both** with this single block, placed where the filter row was (the freshness line moves up into row one; delete its old standalone occurrence):

```tsx
<div className="grid gap-2.5 border-t border-(--line) pt-4">
  {/* Row 1 — actions + freshness */}
  <div className="flex items-center gap-2.5">
    <button
      type="button"
      aria-expanded={filtersOpen}
      onClick={() => setFiltersOpen((open) => !open)}
      className={ghostButtonClass}
    >
      <SlidersHorizontal size={15} aria-hidden />
      Filters
      {activeFilterCount > 0 ? (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--ink) px-1 text-[11px] font-bold text-white">
          {activeFilterCount}
        </span>
      ) : null}
      <ChevronDown
        size={14}
        aria-hidden
        className={`text-(--faint) transition-transform duration-150 ${filtersOpen ? "rotate-180" : ""}`}
      />
    </button>

    <Link href="/ad-radar/swipe-file" className={ghostButtonClass}>
      <Bookmark size={13} aria-hidden />
      Swipe file
    </Link>

    <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11.5px] text-(--faint)">
      <Clock3 size={13} aria-hidden className="shrink-0" />
      <span className="truncate">
        {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
      </span>
    </span>
  </div>

  {/* Row 2 — sort, full width on mobile */}
  <div
    role="group"
    aria-label="Sort ads"
    className="flex w-full items-center rounded-full border border-(--line) bg-(--surface) p-0.5 sm:w-auto sm:self-end"
  >
    <button
      type="button"
      aria-pressed={sort === "recent"}
      onClick={() => onChangeSort("recent")}
      className={`${sortChipClass(sort === "recent")} flex-1 sm:flex-none`}
    >
      Most recent
    </button>
    <button
      type="button"
      aria-pressed={sort === "longest"}
      onClick={() => onChangeSort("longest")}
      className={`${sortChipClass(sort === "longest")} flex-1 sm:flex-none`}
    >
      Longest running
    </button>
  </div>
</div>
```

Notes:

- The literal `Sort` label span is deleted. The segmented control is self-evident and `aria-label="Sort ads"` keeps it named.
- `ghostButtonClass` and `sortChipClass` already exist in this file. Do not redefine them.
- Keep the `Clock3`, `Bookmark`, `SlidersHorizontal`, `ChevronDown` imports; they are all still used.
- **Do not introduce the strings "Meta Ad Library" or "Meta pages" anywhere in this file.** `tests/ad-radar-search-suggestions.test.ts` asserts their absence from this exact file.

### 5.2 Acceptance

At 390 px the control cluster is exactly two rows. At ≥640 px it is visually unchanged from today (actions left, sort right).

---

## 6. Task 5 — Auto-load results from the Brand Pack suburb

### 6.1 New file: `src/lib/research/brand-pack-suburb.ts`

Pure, dependency-free, unit-testable. No Supabase, no React.

```ts
/**
 * Derive an Ad Radar search term from a Brand Pack contact address.
 *
 * The Brand Pack has no suburb field — only `contact.address`, a free-text
 * string extracted from the customer's website. Australian addresses reliably
 * end "<suburb> <STATE> <postcode>", so we take the postcode when present
 * (postcodes are the highest-confidence Ad Radar search key) and fall back to
 * the suburb token before the state abbreviation.
 *
 * Returns null when nothing confident can be extracted. Callers must fall back
 * to the existing IP-based location guess in that case.
 */

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export type BrandPackLocation = {
  /** The term handed to the Ad Radar search API. */
  searchTerm: string;
  /** Human label for the "showing ads near X" caption. */
  label: string;
};

export function resolveBrandPackLocation(address: string | null | undefined): BrandPackLocation | null {
  if (typeof address !== "string") return null;
  const cleaned = address.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;

  const statePattern = AU_STATES.join("|");
  // "…, Scarborough WA 6019" / "Scarborough, WA, 6019" / "Scarborough WA6019"
  const full = new RegExp(
    `([A-Za-z][A-Za-z'\\- ]{1,40}?)[,\\s]+(${statePattern})[,\\s]*([0-9]{4})\\b`,
    "i",
  ).exec(cleaned);

  if (full) {
    const suburb = titleCase(full[1]);
    const state = full[2].toUpperCase();
    const postcode = full[3];
    return { searchTerm: postcode, label: `${suburb}, ${state} ${postcode}` };
  }

  // Suburb + state, no postcode.
  const noPostcode = new RegExp(
    `([A-Za-z][A-Za-z'\\- ]{1,40}?)[,\\s]+(${statePattern})\\b`,
    "i",
  ).exec(cleaned);
  if (noPostcode) {
    const suburb = titleCase(noPostcode[1]);
    const state = noPostcode[2].toUpperCase();
    return { searchTerm: suburb, label: `${suburb}, ${state}` };
  }

  // Bare 4-digit postcode anywhere in the string, last one wins (street numbers
  // come first, postcodes come last).
  const postcodes = cleaned.match(/\b[0-9]{4}\b/g);
  if (postcodes && postcodes.length > 0) {
    const postcode = postcodes[postcodes.length - 1];
    return { searchTerm: postcode, label: postcode };
  }

  return null;
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
```

### 6.2 New file: `tests/brand-pack-suburb.test.ts`

Follow the house style (`node:test` + `node:assert/strict`, same as `tests/ad-radar-location.test.ts`). Cover at minimum:

| Input | Expected `searchTerm` | Expected `label` |
|---|---|---|
| `"Shop 3, 122 Scarborough Beach Rd, Scarborough WA 6019"` | `"6019"` | `"Scarborough, WA 6019"` |
| `"12 Brighton Road, Scarborough, WA, 6019"` | `"6019"` | `"Scarborough, WA 6019"` |
| `"Suite 2, 45 King St, Perth WA"` | `"Perth"` | `"Perth, WA"` |
| `"PO Box 91, 6019"` | `"6019"` | `"6019"` |
| `null` / `""` / `"   "` | `null` | — |
| `"123 Main Street"` | `null` | — |

### 6.3 `src/app/(customer)/ad-radar/page.tsx`

Add the Brand Pack lookup **after** the existing location resolution, not before. `tests/hard-reset/research-contracts.test.ts` asserts that `resolveAdRadarLocationSearch(searchTerm,` appears **earlier in the file** than `resolveAdRadarLocationGuess(`. Inserting anything between them, or above them, risks that ordering assertion. Append below.

```diff
 import { headers } from "next/headers";
 import { notFound } from "next/navigation";

 import { AdRadarSearchPanel } from "@/components/research/ad-radar-search-panel";
 import { niche } from "@/config/niche";
 import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
+import { resolveBrandPackLocation } from "@/lib/research/brand-pack-suburb";
 import {
   resolveAdRadarLocationGuess,
   resolveAdRadarLocationSearch,
 } from "@/lib/research/ad-radar-location";
@@
 export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
   if (!niche.features.adRadar) notFound();
-  await requirePageSurfaceAccess("monitor");
+  const { supabase, access } = await requirePageSurfaceAccess("monitor");
   const requestHeaders = await headers();
   const params = searchParams ? await searchParams : {};
   const searchTerm = firstParam(params.q ?? params.postcode).trim();
   const sort: ResearchSort = firstParam(params.sort) === "longest" ? "longest" : "recent";
   const includeSurrounding = isTruthyParam(firstParam(params.includeSurrounding));
   const locationGuess = searchTerm
     ? resolveAdRadarLocationSearch(searchTerm, { includeSurroundingSuburbs: includeSurrounding })
     : resolveAdRadarLocationGuess(requestHeaders);
   const locationLabel = locationGuess?.label ?? "Perth, WA";
+
+  // Brand Pack suburb → auto-load target. Only used when the visitor did not
+  // type a query. Falls back to the IP-derived guess above.
+  const { data: brandKitRow } = await supabase
+    .from("adstudio_brand_kits")
+    .select("contact_json")
+    .eq("workspace_id", access.workspaceId)
+    .limit(1)
+    .maybeSingle();
+  const brandAddress =
+    (brandKitRow as { contact_json?: { address?: string | null } | null } | null)?.contact_json?.address ?? null;
+  const brandLocation = resolveBrandPackLocation(brandAddress);
+
+  const autoSearch = searchTerm
+    ? null
+    : brandLocation ?? (locationGuess ? { searchTerm: locationGuess.label, label: locationGuess.label } : null);
+  const autoSearchSource: "brand_pack" | "location" | null = searchTerm
+    ? null
+    : brandLocation
+      ? "brand_pack"
+      : locationGuess
+        ? "location"
+        : null;

   return (
     <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
       …
       <AdRadarSearchPanel
         initialIncludeSurrounding={includeSurrounding}
         initialQuery={searchTerm}
         initialSort={sort}
         initialLocationLabel={locationLabel}
         initialNote=""
+        autoSearchTerm={autoSearch?.searchTerm ?? null}
+        autoSearchLabel={autoSearch?.label ?? null}
+        autoSearchSource={autoSearchSource}
       />
```

`requirePageSurfaceAccess("monitor")` already returns `{ supabase, access }` — the same destructure is used on `/leads`. RLS scopes the read to the caller's workspace; no service client, no new query surface.

### 6.4 `src/components/research/ad-radar-search-panel.tsx`

Extend the props:

```diff
 type Props = {
   initialQuery: string;
   initialSort: ResearchSort;
   initialIncludeSurrounding: boolean;
   initialLocationLabel: string;
   initialNote: string;
+  /** Search fired on mount when the visitor did not type a query. */
+  autoSearchTerm?: string | null;
+  autoSearchLabel?: string | null;
+  autoSearchSource?: "brand_pack" | "location" | null;
 };
```

Replace the mount effect:

```diff
   useEffect(() => {
-    if (initialQuery) doSearch(initialQuery, initialSort, initialIncludeSurrounding);
+    if (initialQuery) {
+      doSearch(initialQuery, initialSort, initialIncludeSurrounding);
+    } else if (autoSearchTerm) {
+      // Lazy first paint: the panel renders immediately, results stream in.
+      doSearch(autoSearchTerm, initialSort, initialIncludeSurrounding);
+    }
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
```

Add the provenance caption directly above the results grid, inside the `{searched ? (` results section, replacing the existing heading `<div>`:

```diff
           <div>
             <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
               {query ? `Results for "${query}"` : `Ads near ${autoSearchLabel ?? initialLocationLabel}`}
             </h2>
             <p className="mt-0.5 text-xs text-muted-foreground">
+              {!query && autoSearchSource === "brand_pack" ? "From your Brand Pack address. " : null}
               {cards.length} ad{cards.length === 1 ? "" : "s"} across {advertiserCount} advertiser page
               {advertiserCount === 1 ? "" : "s"}
               {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : ""}.
             </p>
           </div>
```

### 6.5 Rules

- The auto-search must **not** write into the input. The box stays empty (Task 3).
- The auto-search must **not** push a URL query param or trigger navigation.
- If `autoSearchTerm` is null, behaviour is exactly as today: empty state until the user searches.
- Keep the 300 ms debounce in `doSearch` as-is.

### 6.6 Acceptance

Workspace **with** an approved Brand Pack carrying a parseable address: `/ad-radar` shows results for that suburb on arrival, with the caption "From your Brand Pack address." Workspace **without**: falls back to the IP guess. Both: search box empty.

---

## 7. Task 6 — Ad Radar results 2-up on mobile + fullscreen viewer

This is the largest task. Build it in the order below.

### 7.1 New file: `src/components/ui/creative-viewer.tsx`

Shared by Ad Radar (Task 6) and the template gallery (Task 8). Built on the existing shadcn `Dialog` primitive — confirm `src/components/ui/dialog.tsx` exists on your branch before starting; it does on `origin/main`.

Contract:

```ts
export type CreativeViewerItem = {
  id: string;
  /** Rendered in the stage. Exactly one of these. */
  media: { kind: "image" | "video"; url: string; posterUrl?: string | null } | null;
  title: string;            // advertiser name / template name
  subtitle?: string;        // "Active · running 34 days" / "Feed · 4:5"
  body?: string | null;     // ad primary text, or template input summary
  footnote?: string | null; // "realmark.com.au · Library ID 1234"
};

export function CreativeViewer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CreativeViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; href?: string; onClick?: () => void };
}): React.ReactElement;
```

Behavioural requirements — all mandatory:

1. **Fills the viewport, does not scroll.** `fixed inset-0`, height `100dvh` (not `100vh` — mobile browser chrome), `overflow-hidden`, `overscroll-behavior: contain`. While open, set `overflow: hidden` on `<body>` and restore it exactly on close (shadcn `Dialog` already does this; do not add a second mechanism).
2. **Creative is fitted, never cropped.** `object-fit: contain`, `max-height: 100%`, `max-width: 100%` on the stage child.
3. **Layout:** header row (close ✕ + title/subtitle + optional right slot) → flexible stage (`flex-1 min-h-0`) → body/footnote block (max 3 lines, `line-clamp-3`) → pinned action row with `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`.
4. **Dismiss:** ✕ button, Esc, backdrop, and swipe-down. Push a history entry on open and `history.back()` on close so the Android hardware back button dismisses instead of leaving the page.
5. **Paging:** horizontal swipe moves `index` within `items`, clamped at both ends (no wrap). Left/Right arrow keys do the same on desktop.
6. **Video:** `playsInline muted loop autoPlay` with a tap-to-unmute control. Pause and reset when the viewer closes or the index moves off it.
7. **Accessibility:** `role="dialog"`, `aria-modal="true"`, `aria-label={items[index].title}`, focus trapped inside (shadcn `Dialog` gives you this), focus returned to the triggering element on close.
8. **Reduced motion:** honour `prefers-reduced-motion` — entrance collapses to opacity-only. Use `src/lib/motion.ts`; do not hand-roll springs.
9. **Tokens only.** Dark stage background: use `--ink` at full strength, white text. No new colours.

### 7.2 New file: `src/components/research/meta-ad-tile.tsx`

The compact mobile tile. Server-safe (no `"use client"` needed unless you add the click handler here — pass `onOpen` down from the grid, which is already a client component).

Structure:

```tsx
<button
  type="button"
  onClick={onOpen}
  aria-label={`Open ${card.pageName} ad`}
  className="grid w-full min-w-0 cursor-pointer overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) text-left shadow-card"
>
  <span className="relative block aspect-[4/5] w-full overflow-hidden bg-(--surface-subtle)">
    {/* image, or video poster with a play badge; `loading="lazy"` */}
    <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-(--surface)/92 px-2 py-0.5 text-[10.5px] font-bold">
      <span className={`size-2 rounded-full ${statusTone.dot}`} aria-hidden />
      {statusLabel}
    </span>
  </span>
  <span className="grid gap-[3px] px-2.5 pt-2 pb-2.5">
    <span className="truncate text-[11.5px] font-semibold text-muted-foreground">{card.pageName}</span>
    <span className="line-clamp-2 text-[12.5px] leading-[1.32] font-bold text-foreground">
      {card.headline ?? card.body ?? ""}
    </span>
    <span className="text-[10.5px] text-(--faint)">{metaLine}</span>
  </span>
</button>
```

Rules:

- `metaLine` = run duration + format, e.g. `Running 34 days · Video`. Derive duration from `startedAt`/`stoppedAt` with the existing `deliveryDateText` logic pattern; derive format from `card.media` (`0` → `Text only`, `1` + `kind` → `Image`/`Video`, `>1` → `Carousel`).
- **Never render a `<video>` in the tile.** Use `media.posterUrl ?? media.url` as an `<img>` with a play badge. Video elements in a grid are a mobile performance trap.
- Zero-media ads: render a `bg-(--surface-subtle)` block with the text `Text-only ad`, same aspect ratio, so the grid stays even.
- `STATUS_TONE` mapping is duplicated from `meta-ad-library-card.tsx`. **Export it from the card file and import it here** rather than copying the object — AGENTS.md, "Delete > simplify > abstract", and two copies will drift.

### 7.3 `src/components/research/ad-radar-results-grid.tsx`

Add a breakpoint hook and branch. **Do not delete `MasonryItem`, the `ResizeObserver`, or the `gridRowEnd` span logic** — `tests/ad-radar-results-grid.test.ts` asserts all three strings are present in this file.

```tsx
/** True at ≥640px. False on the server and on first paint. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}
```

There is **no hydration risk** here: the results grid only renders after `searched` flips true from a client-side fetch, so the server never emits it.

Render branch:

```tsx
{isDesktop ? (
  <div className="grid items-start gap-4 [grid-auto-rows:8px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]">
    {visibleCards.map((card) => (
      <MasonryItem key={card.id}>
        <MetaAdLibraryCard card={card} />
      </MasonryItem>
    ))}
  </div>
) : (
  <div className="grid grid-cols-2 items-start gap-3">
    {visibleCards.map((card, cardIndex) => (
      <MetaAdTile key={card.id} card={card} onOpen={() => openViewerAt(cardIndex)} />
    ))}
  </div>
)}
```

Then mount one `<CreativeViewer>` for the whole grid (not one per card), fed by `visibleCards.map(toViewerItem)`.

`toViewerItem(card)` maps:

| Viewer field | Source |
|---|---|
| `id` | `card.id` |
| `media` | `card.media[0] ?? null` |
| `title` | `card.pageName` |
| `subtitle` | status label + run duration |
| `body` | `card.body` |
| `footnote` | destination domain + `Library ID: …` when present |

Viewer actions for Ad Radar:

- **Primary:** `Save to swipe file` → the same `POST /api/research/swipe-file` call `AdCardActions` already makes. Reuse the logic; do not duplicate the fetch. Extract it to a small hook if needed.
- **Secondary:** `Open in Meta` → `https://www.facebook.com/ads/library/?id=<libraryId>`, `target="_blank" rel="noreferrer"`. Omit when `libraryId` is null.

### 7.4 Do not break these

- `e2e/meta-ad-library-card.spec.ts` runs at Playwright's default desktop viewport, so it exercises the **desktop** branch. That branch is unchanged. (Note: this spec's assertions target legacy `.meta-ad-card` classes that no longer exist on `origin/main`, so the test currently self-skips. Do not "fix" it in this PR — out of scope, and it would hide a real signal.)
- `tests/hard-reset/research-contracts.test.ts` scans `meta-ad-library-card.tsx` for leaked internal identifiers. Your new tile file is not scanned today, but **hold it to the same bar**: no `observed_ad_id`, `external_ad_id`, `source_provider`, `raw_payload`, `payload_hash`, `ad_snapshot_id` rendered anywhere.

### 7.5 Acceptance

390 px `/ad-radar` with results: two tiles per row, even heights, no horizontal scroll. Tapping a tile opens the viewer; the creative is fully visible with no cropping and no page scroll behind it; swiping left/right moves between ads; ✕, Esc, backdrop and Android back all dismiss; focus returns to the tapped tile. ≥640 px: byte-identical to today.

---

## 8. Task 7 — Bottom tab bar gains Performance (six items)

### 8.1 `src/config/niche/niche.ts`

```diff
   nav: {
     items: NicheNavItem[];
-    /** The four primary mobile tabs (bottom tab bar). */
+    /** The primary mobile tabs (bottom tab bar). Five maximum — a sixth
+     *  "More" button is appended by the shell. */
     mobileTabs: { href: string; label: string }[];
   };
```

### 8.2 `src/config/niche/blockwise.ts`

```diff
     mobileTabs: [
       { href: "/self-serve", label: "Home" },
       { href: "/ad-studio", label: "Studio" },
       { href: "/ad-radar", label: "Radar" },
+      { href: "/results", label: "Results" },
       { href: "/leads", label: "Leads" },
     ],
```

**The label is `Results`, not `Performance`.** At six tabs on a 390 px screen each tab is ~61 px wide and the label must drop to 9.5 px; "Performance" truncates to "Perform…". "Results" fits and is already the label this route carries in the operator and monitor navs, so it introduces no new noun. The sidebar keeps "Performance" — `nav.items` is untouched.

### 8.3 `src/components/self-serve-shell.tsx`

In `SelfServeMobileNav`:

```diff
-        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-border bg-card/95 px-2.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-2xl md:hidden"
+        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 gap-0.5 border-t border-border bg-card/95 px-1.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-2xl md:hidden"
```

And on both the tab `<Link>` and the More `<button>`:

```diff
-                "grid min-h-12 min-w-0 place-items-center gap-[3px] rounded-xl px-0.5 py-1 text-[10.5px] leading-[1.1] font-bold …",
+                "grid min-h-12 min-w-0 place-items-center gap-[3px] rounded-xl px-0.5 py-1 text-[9.5px] leading-[1.1] font-bold …",
```

Icon size `21` → `19` on the tab links; the More icon `22` → `20`.

`selfServeIcons["/results"]` already maps to `LineChart` in `src/components/sidebar-nav.tsx`. No icon work needed.

### 8.4 Acceptance

At 390 px: six evenly-spaced tabs, every label on one line and not truncated, row height ≥ 48 px. Repeat at **360 px** (Galaxy A-series) — tabs land at ~56 px and labels must still not truncate. If "Results" truncates at 360 px, stop and report rather than shrinking type below 9.5 px.

The More sheet must still contain Property Check, Brand Pack and Settings — it is derived by subtracting `mobileTabs` from `nav.items`, so this happens automatically. Verify it.

---

## 9. Task 8 — Template gallery 2-up on mobile

All changes are inside `src/components/adstudio/new-ad-dialog.tsx` (the component and its embedded `<style>` string).

### 9.1 Grid

```diff
 @media(max-width:560px){
   …
-  .studio-explore-grid{grid-template-columns:1fr}
   …
 }
```

Delete that one declaration. The `max-width:900px` block already sets `repeat(2,1fr)`, which now applies all the way down. Also tighten the gap in the 560 block:

```diff
 @media(max-width:560px){
+  .studio-explore-grid{gap:10px}
```

### 9.2 Even tile heights

Feed templates render at 4:5, story templates at 9:16. Side by side that is ragged. Inside the `max-width:560px` block:

```css
.studio-explore-card--fullscreen .studio-template-ad--fullscreen{aspect-ratio:4/5;margin:8px;border-radius:10px}
```

`object-fit:cover` on `.studio-template-story-media` already handles the crop. The true placement stays legible from the `FEED` / `FULLSCREEN` label in the card head — keep that label.

### 9.3 Drop the footer bar on mobile

```css
@media(max-width:560px){
  .studio-explore-card-action{display:none}
}
```

It doubled tile height to repeat "Use this template" six times per screen. The action moves into the viewer.

### 9.4 Tap opens the viewer

`TemplateChoiceCard` currently calls `onSelect(template.id)` directly. Change it to open `CreativeViewer` (§7.1) with:

- `media`: `{ kind: "image", url: templatePreviewSrc(template, brandKit) }`
- `title`: `template.name`
- `subtitle`: `` `${isFullscreen ? "Fullscreen" : "Feed"} · ${template.format}` ``
- `body`: a one-line summary of the declared inputs — image slots and text fields the template requires
- **Primary action:** `Use this template` → the existing `chooseTemplate(template.id)`. This is the only path that may select a template.
- **Secondary action:** `Back` → close the viewer.

Swiping pages through `visibleTemplates` in the current category filter.

**Behaviour change — flagged and accepted by the owner:** selecting a template is now two taps (preview, then confirm) instead of one. Update `aria-label` on the card from `Use ${template.name} … template` to `Preview ${template.name} … template`.

### 9.5 Do not

- Change any template JSON, `templatePreviewDataUrl`, `buildCloneImageRequest`, or the generation flow.
- Change the desktop (≥900 px) 3-up grid.
- Change `.studio-explore-thumb` — it belongs to a different surface.

### 9.6 Acceptance

`npm run verify:hard-reset` still reports 71 templates and passes `adstudio-templates.mjs`. At 390 px the gallery is two even columns; tapping previews; "Use this template" in the preview still creates the ad exactly as before.

---

## 10. Task 9 — Performance mobile polish

Do this **after** Task 1's overflow fix is confirmed and merged into your branch.

### 10.1 Short range chips

`src/config/niche/niche.ts` — extend `PerformanceCopy`:

```diff
   ranges: { d7: string; d30: string; d90: string };
+  /** Compact labels for the mobile chip row. */
+  rangesShort: { d7: string; d30: string; d90: string };
```

`src/config/niche/blockwise/performance.ts`:

```diff
   ranges: { d7: "7 days", d30: "30 days", d90: "90 days" },
+  rangesShort: { d7: "7d", d30: "30d", d90: "90d" },
```

`src/components/monitor/MetaMonitorHeader.tsx` — in the primary chip loop, render both and toggle by breakpoint:

```tsx
<span className="sm:hidden">{copy.rangesShort[preset.key]}</span>
<span className="hidden sm:inline">{copy.ranges[preset.key]}</span>
```

Do the same for the "More ranges" trigger: show `⋯` plus `sr-only` text on mobile, the full `copy.moreRanges` label at `sm:`.

### 10.2 KPI tiles at half width

`src/components/monitor/MetaKpiCard.tsx`:

```diff
-      <div className="mt-[7px] font-display text-[24px] font-extrabold tracking-[-0.02em] tabular-nums">
+      <div className="mt-[7px] font-display text-[21px] font-extrabold tracking-[-0.02em] tabular-nums sm:text-[24px]">
         {props.value}
       </div>
```

```diff
         {props.compareText ? (
-          <span className="text-[10.5px] font-medium text-(--faint)">{props.compareText}</span>
+          <span className="hidden text-[10.5px] font-medium text-(--faint) sm:inline">{props.compareText}</span>
         ) : null}
```

The trend badge (`↗ 14.0%`) stays visible at all sizes. The "vs previous 30 days" tail is redundant on mobile — the active range chip already states the window.

### 10.3 Explicitly NOT doing

**Do not abbreviate numbers** (`1,204,880` → `1.20M`). The approved mockup showed abbreviation; it is dropped here deliberately. It would mean either a new formatter in `src/lib/meta-monitor/calculations.ts` (covered by tests, and shared with the operator surface) or a second `value` prop threaded through every call site — cost and regression risk out of proportion to the gain, now that the type ramp handles the width. If a real value still overflows its tile after 10.2, report it rather than improvising.

### 10.4 Acceptance

390 px `/results`: six KPI tiles in two columns, all six reachable without horizontal scrolling, no value clipped or wrapped mid-number, range chips on one row.

---

## 11. Mandatory `$impeccable` workflow

AGENTS.md requires this for every UI task. Non-negotiable.

**Invoke `$impeccable` explicitly** and state the commands before editing. For this scope the minimum sequence is:

| Phase | Command | Applies to |
|---|---|---|
| Before any edit | `audit` | `/results` at 390 px — this *is* Task 1's diagnosis |
| Before any edit | `critique` | `/leads`, `/ad-radar`, `/results` at 390 px |
| During | `adapt` | every task — this is responsive work end to end |
| During | `layout` | Tasks 2, 4, 6, 8 (grid and rhythm changes) |
| During | `harden` | Task 6's viewer — edge cases, video failure, missing media, focus |
| Before PR | `polish` | all six surfaces |

Inspect the current interface in Chrome **before** changing it (rule 3 of the mandatory workflow), and verify the result in Chrome at desktop and mobile sizes **after** (rule 6).

### Required report (put this in the PR description)

- Skills loaded
- Impeccable commands used
- Routes inspected
- Viewport sizes checked
- Remaining visual or interaction issues

---

## 12. Deviations from the approved mockup

State these in the PR so nobody thinks they were missed.

| Mockup showed | Spec says | Why |
|---|---|---|
| Tab labelled "Performance" | `Results` | "Performance" truncates in a 61 px tab at 9.5 px |
| KPI values abbreviated (`1.20M`) | Full numerals, smaller type | §10.3 — shared formatter, out-of-proportion risk |
| Helper sentence removed from the DOM | Kept as `sr-only` | `aria-describedby` target + an existing test asserts the source reference |
| Ad Radar masonry "goes away" | Kept for ≥640 px, mobile uses a plain 2-col grid | An existing test asserts the masonry code is present in that file |

---

## 13. Verification protocol

### 13.1 Gates that must pass before the PR opens

```bash
npm run check            # check:nul + 933 tests + typecheck
npm run verify:hard-reset
```

Both green. If you changed a test, say which and why in the PR — AGENTS.md forbids skipping tests and requires deliberate updates.

### 13.2 Measurement script (all six routes)

Re-run §2.3's script against `/self-serve`, `/leads`, `/ad-radar`, `/results`, `/settings`, `/ad-studio` at **390, 360 and 430** px. Every route, every width: `scrollWidth === innerWidth`. Paste the table into the PR.

### 13.3 Manual pass on a Vercel Preview URL

Localhost does not count. On the Preview deployment, at 390 px:

- [ ] `/leads` — 2 + 1 stat tiles, empty state above the fold
- [ ] `/ad-radar` — empty search box, no helper sentence, two control rows, results auto-loaded, 2-up tiles
- [ ] `/ad-radar` — tap a tile: fullscreen, no crop, no page scroll, swipe pages, ✕ / Esc / back all dismiss, focus returns
- [ ] `/results` — six KPI tiles in two columns, no horizontal scroll, campaigns table still scrolls inside its panel
- [ ] Bottom nav — six tabs, no truncation at 390 **and** 360 px; More sheet still holds Property Check, Brand Pack, Settings
- [ ] `/ad-studio` new-ad dialog — 2-up templates, preview on tap, "Use this template" still creates the ad
- [ ] Dark mode: every changed surface (the theme toggle is in the topbar)
- [ ] `prefers-reduced-motion: reduce`: viewer entrance is opacity-only

### 13.4 Cleanup before reporting done

Follow `hermes/skills/blockwise-agent-cleanup/SKILL.md`. Delete `scripts/tmp/measure-results-overflow.mjs`. Leave no dirty residue beyond the owner's pre-existing dirty files, which you must not touch.

---

## 14. Suggested commit sequence

One commit per task keeps the diff reviewable and lets Task 1 be reverted independently if the overflow fix turns out to have side effects.

1. `fix(shell): clamp customer surface width at mobile` — Task 1
2. `feat(leads): two-up stat tiles on mobile` — Task 2
3. `feat(ad-radar): start the search field empty and drop the scope line` — Task 3
4. `feat(ad-radar): collapse the control cluster to two rows on mobile` — Task 4
5. `feat(ad-radar): auto-load results from the Brand Pack suburb` — Task 5
6. `feat(ad-radar): two-up result tiles with a fullscreen creative viewer` — Task 6
7. `feat(shell): add Results to the mobile tab bar` — Task 7
8. `feat(ad-studio): two-up template gallery with fullscreen preview` — Task 8
9. `feat(results): mobile KPI and range-chip density` — Task 9

Owner pre-authorises staging, committing, pushing, merging once green, and Vercel deployment (AGENTS.md, "Git scope"). Log decisions in the PR description.

---

## 15. Stop-and-ask triggers

Do not improvise past any of these. Report and wait.

1. Task 1's measurement does not confirm the `SidebarInset` diagnosis.
2. `npm run check` or `verify:hard-reset` fails on clean `origin/main` before you have edited anything.
3. Any change requires editing a test assertion not listed in §12.
4. "Results" truncates at 360 px in the six-tab bar.
5. A Brand Pack address format appears in real data that the parser cannot handle and that is not covered by §6.2's table.
6. The fullscreen viewer cannot satisfy "no scroll" for a given creative (e.g. an extreme aspect ratio) without cropping it.
