# Execution Plan — Self‑Serve UX Improvements (Ad Studio)

**Type:** Simplification PR (tag the PR `simplification`). State in the PR
description which user-facing complexity each change removes.

**Scope guard:** No schema changes, no auth changes, no public API response-shape
changes, no provider-behaviour changes (per `AGENTS.md`). No new dependencies.

## Pre-flight (required by AGENTS.md)

1. Check CodeGraph freshness (`codegraph_status` / `codegraph sync`). If a
   stale-file banner appears for any file below, read that file directly before
   editing.
2. Do **not** run local deployments. Validate behaviour on a Vercel Preview URL,
   not localhost. `npm run lint` / `npm run build` for typecheck only is fine.
3. Realities confirmed in the code that the original draft got wrong, and the
   implementer must respect:
   - `performance` is **typed but never destructured** in
     `ad-studio-workbench.tsx`.
   - The `formatCents` helper the draft referenced does **not** exist at the
     claimed paths (`src/lib/format-cents.ts`, `src/components/adstudio/settings-view.tsx`).
     The real one is a private fn in `src/app/(customer)/settings/settings-view.tsx`.
   - `performance` is computed once at page load; it does **not** update when the
     user edits the campaign in the panel.
   - `costPerLeadAud` is already in **AUD** (e.g. `22`), not cents.
   - The combined market string is parsed on save by
     `use-campaign-actions.ts` (~line 59) via `split(",").map(trim)`, first two
     segments only.

---

## Task 1 — Split Market/Location into Suburb + State

**File:** `src/components/adstudio/panels/campaign-panel.tsx`

Replace the single `FieldShell label="Market / Location"` input (currently lines
~134–136) with two stacked `FieldShell`s: **Suburb** and **State**.

Requirements:

- Keep the public contract unchanged: the component still receives `market:
  string` and calls `setMarket(value: string)` with the combined `"Suburb, State"`
  format. `useReadiness` and `useCampaignActions` continue to consume the combined
  string — do **not** touch them.
- Seed two pieces of **local** state from the incoming `market` prop **once** (via
  a `useState` initializer). Do not re-derive local state from the `market` prop on
  every render — that fights the user mid-type.
- **Match the existing save parser's split semantics.** `use-campaign-actions.ts`
  (~line 59) parses the combined string with `s.market.split(",").map(p =>
  p.trim())` and keeps only the first two segments. So in the panel: split the
  incoming prop on the **first comma** (not requiring a space) and trim, so data
  stored as `"Scarborough,WA"` displays correctly. If there is no comma, treat the
  whole string as suburb and leave state empty.
- On either field's change, recombine as `[suburb, state].filter(Boolean).join(", ")`
  and call `setMarket(...)`. Recombining with `", "` is safe — the save parser
  trims it back. **No change to `use-campaign-actions.ts` is required**; confirm
  this rather than editing it.
- Do **not** introduce a new default suburb/state in the panel (the save path
  already falls back to `"South Perth"/"WA"` and `initialMarket` to `"Perth, WA"`
  — a third default would diverge). Leave a missing field empty.
- Keep the `MapPin` icon on the Suburb field (or one shared icon). State is a
  free-text input — do **not** hardcode an AU-state dropdown; existing data may
  hold arbitrary strings. (`FieldShell` already wraps each input in its own
  `<label>`, so two fields are accessible by construction.)

Acceptance:

- Trial workspace opens with Suburb "Scarborough", State "WA" (the trial seed in
  `ad-studio/page.tsx`).
- Editing either field updates the combined string; the rail "Location" readiness
  indicator still reflects it; saving persists suburb + state correctly.
- Deleting a campaign and creating a new one still works.

---

## Task 2 — Self‑serve CTAs + real remaining-packs count

**File:** `src/app/(customer)/self-serve/page.tsx`

### 2a. Conditional CTAs

Extract the link set into a small local helper/variable used by **both**
`PageHeading.actions` and the `.wizard-actions` block (they are duplicated today).

- `hasAd === false`: primary **"Create first ad"** → `/ad-studio?first=1`;
  secondary **"Set up workspace"** → `/onboarding`.
- `hasAd === true`: primary **"Open Ad Studio"** → `/ad-studio` (no `first=1`, so
  the first-run explainer is skipped); secondary **"Set up workspace"** →
  `/onboarding`.

Do **not** ship two buttons that both point to `/ad-studio` with different labels
("Create another ad" + "View your ads" in the original draft) — `/ad-studio` is the
only campaign surface and the TopBar already exposes a campaign switcher when more
than one exists. One primary "Open Ad Studio" removes a redundant decision.

### 2b. Remaining ad packs — use the real source, not `10 - campaigns.count`

The original draft's `remainingPacks = 10 - campaigns.count` is wrong: packs are
consumed per **generation**, not per campaign, and an authoritative source already
exists.

- Trial pack numbers come from the `get_trial_status` RPC with a campaign-count
  fallback. **This logic is currently duplicated in two server locations** —
  `src/app/api/trial/status/route.ts` and `src/components/app-shell.tsx` (which
  renders the `TrialStatusPill`). The two copies already drift slightly (the route
  retries the RPC with both `target_workspace_id` and `workspace_id`; app-shell
  uses only `target_workspace_id`).
- Extract one shared server helper, e.g. `src/lib/adstudio/trial-status.ts`
  exporting `loadTrialStatus(supabase, workspaceId): Promise<TrialStatus | null>`
  plus the `normalizeRpcTrialStatus` / `numeric` primitives and `INCLUDED_AD_PACKS`.
  Move the `TrialStatus` type there (or re-export it) so a UI component
  (`trial-status-pill.tsx`) no longer owns a server type.
- Re-point **all three** consumers at it: the route, `app-shell.tsx`, and the new
  self-serve page. This guarantees the self-serve number and the app-shell pill
  agree on the same screen, and it reduces net LOC (a clean refactor under
  `AGENTS.md`).
  - **Preserve each call site's behaviour exactly.** Diff app-shell's
    `loadInitialTrialStatus` (it gates on `workspaceMode` / `isOperator`) against
    the route's `loadFallbackTrialStatus` before merging. If their gating differs
    meaningfully, keep the gating at the call site and share only the
    normalize/fallback primitives — at minimum the self-serve page must use the
    **same primitives** as the pill so the numbers provably match. Confirm
    `GET /api/trial/status` returns byte-identical JSON afterward.
- In `self-serve/page.tsx` (a server component) call `loadTrialStatus(...)` with the
  page's already-authed `supabase` and render under the trial panel:
  `{remainingAdPacks} of {includedAdPacks} free ad packs remaining`. If it returns
  `null` (not a trial workspace), render nothing for this line.

Acceptance:

- New trial user (no ads): CTAs show "Create first ad" + "Set up workspace" and
  "10 of 10 free ad packs remaining".
- After generating: count matches the app-shell `TrialStatusPill` for the same
  workspace; CTAs show "Open Ad Studio" + "Set up workspace".
- Non-trial workspace: no packs line, no crash.

---

## Task 3 — Surface performance metrics (correctly labelled)

**Files:** `src/app/(customer)/ad-studio/page.tsx`,
`src/components/adstudio/ad-studio-workbench.tsx`,
`src/components/adstudio/topbar.tsx`, new `src/lib/format-currency.ts`.

### 3a. Currency helper

Create `src/lib/format-currency.ts`:

```ts
export function formatAud(amount: number, opts?: { decimals?: number }): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: opts?.decimals ?? 0,
  }).format(amount);
}
```

`performance.costPerLeadAud` is already in AUD, so call
`formatAud(performance.costPerLeadAud)`. Do **not** multiply by 100. (Optionally
refactor the private `formatCents` in `settings-view.tsx` to use `formatAud`, but
that is not required — leave it unless trivial, to limit blast radius.)

### 3b. Thread the prop through (it is currently dropped)

In `ad-studio-workbench.tsx`, add `performance` to the destructured props (it is in
`AdStudioWorkbenchProps` but never pulled out today). Pass it to `TopBar`.

### 3c. Pass an honest "is this real?" flag — NOT `isSample`

**Do not key the illustrative label off `isSample`.** In `ad-studio/page.tsx`,
`isSample = liveBundle === null && trialBundle === null` (pure demo only). A
**trial** workspace gets the same fake demo numbers
(`getAdStudioDemoBundle().performance`, e.g. 43 leads / $22 CPL) but has
`isSample === false`, so keying off `isSample` would show invented numbers to trial
users with no warning.

- In `ad-studio/page.tsx` compute `performanceIsReal = liveBundle !== null` and
  pass it down (page → `AdStudioWorkbench` new `performanceIsReal` prop → TopBar).

### 3d. Render in TopBar

**File:** `src/components/adstudio/topbar.tsx`

- Add optional `performance?: AdStudioWorkbenchProps["performance"]` and
  `performanceIsReal?: boolean` props (reference the existing type; do not
  duplicate the literal).
- Visibility, honestly:
  - **Live workspace with no data** returns `EMPTY_PERFORMANCE` (all zeros). When
    `leads === 0 && costPerLeadAud === 0`, render **nothing** — never show
    "$0 / 0 leads" as a result.
  - When shown and `performanceIsReal === false`, prefix with **"Example —"**.
- When shown, render a compact line in the **desktop** `.studio-titlebar` area only
  (TopBar has a separate `.studio-mobile-title`; keep the performance line out of
  the mobile header or hide it under the existing breakpoint). Plain text, not a
  heading; mark `·` separators `aria-hidden`. Example:
  `Example — Est. leads {leads} · {formatAud(costPerLeadAud)}/lead · {bookedAppraisals} appraisals`
  Round `leads` and `bookedAppraisals` as integers.

### 3e. Do not claim live updates

`performance` is loaded once on the server and is **not** recomputed when the user
edits goal/offer/market. Do not add any test or copy implying the numbers change on
edit. (Live-on-edit is a separate, larger task — out of scope unless asked.)

Acceptance:

- Trial/sample studio shows "Example — Est. leads 43 · $22/lead · 6 appraisals".
- Live workspace with real projections shows the line with **no** "Example —".
- Live workspace with zero performance shows **no** line (no fake zeros).
- No regression to TopBar save / more-menu / campaign-switcher.

---

## Task 4 — Onboarding wizard (no change)

Confirmed correct: there is no location column on `workspaces`; adding suburb/state
persistence would be a schema change and is out of scope. Trial seeds remain
Scarborough/WA and the user overrides them in the campaign panel. No edits.

---

## Production-readiness

### P1. Unit tests (repo uses `node --test`)

`package.json` defines `"test": "node --test tests/*.test.ts tests/**/*.test.ts"`.
Add `tests/self-serve-improvements.test.ts` covering pure logic:

- **Market split/recombine** (extract `splitMarket`/`joinMarket` as exported pure
  helpers so they're testable without rendering): `"Scarborough, WA"` and
  `"Scarborough,WA"` both → `{suburb:"Scarborough", state:"WA"}`; round-trips back
  to `"Scarborough, WA"`; no comma → suburb only, empty state; extra spaces trim;
  split on the **first** comma only; empty string → both empty.
- **`formatAud`**: `22` → `"$22"`; `decimals: 2` honoured; `0` → `"$0"`.

Run `npm test`; keep green.

### P2. `loadTrialStatus` must stay RLS-safe and not re-auth

- Signature `loadTrialStatus(supabase, workspaceId)` only — it must **not** call
  `requireWorkspaceAccess` / `requirePageSurfaceAccess`. Pass the caller's
  request-scoped client (the self-serve page already authed via
  `requirePageSurfaceAccess("self_serve")`). Do **not** switch to a service-role
  client; RLS must still apply.
- Preserve RPC-first then campaign-count fallback; wrap in try/catch and return
  `null` on any error (the page renders no packs line). The `get_trial_status` RPC
  appears `SECURITY DEFINER`; verify it's callable as the page user.

### P3. TopBar layout / mobile

Performance line in the desktop titlebar only; plain text; `aria-hidden`
separators. Eyeball desktop and ~390px mobile so the breadcrumb/switcher doesn't
wrap or crowd.

### P4. QA matrix (Vercel Preview, both viewports)

1. Fresh trial, no ad → "Create first ad" + "Set up workspace", "10 of 10 packs".
2. Trial after one generation → "Open Ad Studio"; packs count matches app-shell
   `TrialStatusPill`; performance line shows **"Example —"**.
3. Live workspace with campaigns + real projections → line, **no** "Example —".
4. Live workspace, `EMPTY_PERFORMANCE` (zeros) → **no** line, no fake zeros.
5. Pure sample/demo (`isSample`) → SampleBanner + "Example —" performance.
6. Non-trial, non-sample (BrandSetupGate path) → unchanged; no packs line on
   self-serve.

### P5. Rollout

- Single PR, tagged `simplification`; PR body states the complexity removed (one
  location field → two clear fields; one CTA decision instead of two; honest pack
  count; no fake performance shown as real; trial-status logic de-duplicated).
- No feature flag needed given the small surface, but the `performanceIsReal` guard
  and the zero-guard are the safety net for the only user-visible risk (showing
  numbers). **Do not merge if either guard is missing.**
- Out of scope (note in PR, don't build): live-recompute of performance on edit;
  CTA funnel analytics (self-serve CTAs are untracked `<Link>`s today); optional
  "upgrade" link when `remainingAdPacks === 0` (trial status already exposes
  `upgradeHref` / `trialExpired` if you want it later).

---

## Summary of file changes

| File | Change |
|------|--------|
| `src/components/adstudio/panels/campaign-panel.tsx` | Suburb + State inputs; split-once on first comma / recombine `"suburb, state"`; keep combined `setMarket`; no new defaults. |
| `src/app/(customer)/self-serve/page.tsx` | Conditional CTAs (single primary); real remaining-packs via shared helper. |
| `src/lib/adstudio/trial-status.ts` *(new)* | Extracted `loadTrialStatus` + primitives + `TrialStatus` type. |
| `src/app/api/trial/status/route.ts` | Use the extracted helper (byte-identical JSON). |
| `src/components/app-shell.tsx` | Use the extracted primitives so the pill matches self-serve (preserve mode/operator gating). |
| `src/lib/format-currency.ts` *(new)* | `formatAud` (no `*100`). |
| `src/app/(customer)/ad-studio/page.tsx` | Pass `performanceIsReal={liveBundle !== null}`. |
| `src/components/adstudio/ad-studio-workbench.tsx` | Destructure `performance` + `performanceIsReal`; pass to TopBar. |
| `src/components/adstudio/topbar.tsx` | Render performance line; hide zeros; "Example —" when not real; desktop-only. |
| `tests/self-serve-improvements.test.ts` *(new)* | Unit tests for market split/recombine + `formatAud`. |
