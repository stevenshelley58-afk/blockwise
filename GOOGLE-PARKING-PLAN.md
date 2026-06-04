# Google Ads — "Disable, don't delete" plan (Meta-only v1)

Goal: ship a Meta-only v1 fast. Hide/disable everything Google Ads that is user-facing
or runs live, **without deleting code or touching the database**. Fully reversible.

Two things explicitly stay:
- **Gemini AI models** (`google/gemini-*` in model-control) — these power the app and have
  nothing to do with Google *ads*. Leave them.
- **Database** — `provider_key` enum, `google_lead_forms` table, adstudio Google columns.
  You chose leave-as-is. No migration.

Recommended mechanism: add one flag and reference it in the few functional spots, plus
direct edits for visible UI copy/toggles. Re-enabling later = flip the flag + un-hide UI.

```ts
// src/lib/config/feature-flags.ts  (NEW)
export const GOOGLE_ADS_ENABLED = process.env.GOOGLE_ADS_ENABLED === "true"; // default: off
```

---

## A. Health / env readiness
- `src/lib/config/env.ts` — `PROVIDER_ENV_REQUIREMENTS` lists `google` with
  `GOOGLE_CLIENT_ID/SECRET/GOOGLE_ADS_DEVELOPER_TOKEN`. Current `evaluateEnvReadiness`
  sets `ok` from base Supabase keys only, so providers are *already* optional — `/api/health`
  should already report `ready` regardless of Google. **Change:** when `GOOGLE_ADS_ENABLED`
  is false, drop the `google` entry from `PROVIDER_ENV_REQUIREMENTS` so it no longer shows
  as `ok:false` in the health payload a Meta reviewer might read.
- ⚠️ **VERIFY:** `src/app/api/health/route.ts` — couldn't get a clean read; confirm it
  derives status from `readiness.ok` (not from any per-provider check) before editing.
  `docs/meta-app-review/AUDIT.md` claims Google made health = `configuration_incomplete`;
  that may predate the current env.ts logic.

## B. OAuth entry points (block new Google connections)
- `src/app/api/integrations/google/connect/route.ts` — short-circuit at top: if
  `!GOOGLE_ADS_ENABLED` return 404 / redirect `…?integration=google&error=disabled`
  before `buildProviderAuthorizationUrl`.
- `src/app/api/integrations/google/callback/route.ts` — same short-circuit at top.

## C. Live sync (stop pulling Google)
- `src/lib/providers/scheduled-sync.ts:15` — `.in("provider", ["meta","google"])`
  → `.eq("provider","meta")` (or gate the list on the flag).
- `src/app/api/provider-sync/route.ts:22` — `body.provider === "google" ? "google" : "meta"`
  → force `"meta"` (or 400 when google requested while disabled).
- `src/lib/monitor/live-dashboard.ts` — filters `provider === "meta" || "google"` and
  fetches Google Ads reporting for google connections → restrict to meta only.

## D. UI visibility
- `src/app/(customer)/onboarding/page.tsx` — `connections` array lists Google with
  "Fix Google sync" and "1 of 2". → Meta only, "1 of 1". ⚠️ this file read back garbled;
  re-read clean before editing.
- `src/components/monitor/monitor-dashboard.tsx` — provider rows, "Google spend",
  source split "Meta, Google, CSV, manual". → hide Google rows/labels.
- `src/components/adstudio/ad-studio-workbench.tsx` — platform toggle `meta|google` and
  Google format tiles (`g-search`, `g-leadform`, `g-maps`, `g-demand`); line ~275 sends
  `platforms: ["meta","google_search","google_pmax","google_demand_gen"]`. → hide the
  Google tab + tiles, default to Meta, send `["meta"]` only.
- Copy-only (cosmetic) — reword "Meta and Google" → "Meta":
  `src/app/(customer)/campaigns/page.tsx`, `…/leads/page.tsx`, `…/self-serve/page.tsx`.
- `src/app/page.tsx` (marketing landing) — `GoogleAd` mock + google-format ads. Optional;
  leave or trim. Low priority.

## E. AdStudio: stop generating/exporting Google creative (keep the code dormant)
Don't delete the generator/schemas — just stop requesting Google platforms so nothing
Google is produced or exported:
- `src/app/api/adstudio/campaigns/route.ts:66` — default platforms → `["meta"]`.
- `src/app/api/adstudio/campaigns/[id]/generate/route.ts:42` — → `["meta"]`.
- `src/lib/adstudio/demo-data.ts:55`, `src/lib/adstudio/templates.ts` — google defaults → meta.
- `src/app/api/adstudio/export-packages/[id]/publish/route.ts` — google connection/payload
  branch becomes dead when no google copy is generated; safe to leave.

## F. Demo / sample fixtures (cosmetic, not live data)
Optional polish so Meta-only screens don't show sample Google rows:
`src/lib/product/demo-data.ts`, `src/lib/monitor/dashboard-data.ts`,
`src/lib/product/workflow-data.ts`, `src/lib/product/live-data.ts` (the last has a harmless
`provider === "google" ? …` mapping — fine to leave).

## Left untouched on purpose (dormant code, never invoked once B/C are off)
`src/lib/providers/google-reporting.ts`, `oauth-handlers.ts` (google branch),
`publishing-adapters.ts` (google branch), `provider-sync.ts` (google branch),
all adstudio Google types/zod schemas/prompts, the DB.

---

## Reversal
Set `GOOGLE_ADS_ENABLED=true`, restore the hidden UI toggles/copy, and put
`google_*` back in the adstudio platform defaults. No code was deleted.

## Verification before shipping
`npm run typecheck` and `npm test` after edits. (Couldn't run these in the current
sandbox — git lock + intermittent read corruption; run locally to confirm the build.)

## Blast radius
Functional edits: ~8 files (A–C). UI: ~3–4 files (D). AdStudio defaults: ~4 files (E).
Everything else is optional cosmetic. No deletions, no DB changes.
