# Clone Playbook — white-labeling the customer app

How to ship this codebase for a new vertical (e.g. `dentistwise`, `salonwise`) without touching a single component.

The customer app is niche-agnostic by construction: every niche noun, industry phrase, nav label, and feature flag lives in `src/config/niche/`. Components read `niche.*`. Cloning = writing a sibling config folder and flipping one export. Visual identity remains Blockwise Atlantic; clones do not introduce a second palette or component language.

> Scope note: this covers the **customer app** (`src/app/(customer)/` + its components). Landing, auth shell, operator, and monitor surfaces are not white-labeled and must not be edited during a clone.

---

## 1. The single switch

`src/config/niche/index.ts`:

```ts
import { blockwise } from "./blockwise";

/** The single white-label switch. */
export const niche = blockwise;
```

Everything downstream imports `niche` from `@/config/niche`. Point it at a new config and the entire customer surface re-skins.

## 2. Clone steps

1. **Create the config folder** `src/config/niche/<vertical>/` with one file per surface, mirroring `src/config/niche/blockwise/`:

   | File | Exports | Drives |
   |---|---|---|
   | `shell.ts` | `ShellCopy` | command menu, topbar search, trial pill, mobile nav |
   | `home.ts` | `HomeCopy` | home states/KPIs/chart/setup checklist/quick actions |
   | `leads.ts` | `LeadsCopy` | leads page stats, filters, columns, empty states |
   | `performance.ts` | `PerformanceCopy` | results page ranges, chart titles, states |
   | `ad-radar.ts` | `AdRadarCopy` | competitor ad-library surface |
   | `property-check.ts` | `PropertyCheckCopy` | address-report surface |
   | `settings.ts` | `SettingsCopy` | settings page title + section labels |
   | `onboarding.ts` | `OnboardingCopy` | onboarding title + lead |

   The exact shapes are the exported types in `src/config/niche/niche.ts` — TypeScript will flag any missing key. Copy the `blockwise/` files as the starting template, then rewrite the copy for the vertical.

2. **Assemble the config** in `src/config/niche/<vertical>.ts` (mirror `blockwise.ts`):

   ```ts
   import type { NicheConfig } from "./niche";
   import { home } from "./<vertical>/home";
   // …one import per surface file

   export const <vertical>: NicheConfig = {
     key: "<vertical>",
     product: { name: "Dentistwise" },
     industry: {
       label: "Dental",              // workspace chip, brand metadata
       audienceNoun: "dentist",      // "peers" language in copy
       audienceNounPlural: "dentists",
       regionDefault: "AU",
     },
     terms: {
       offer: "treatment", offers: "treatments",   // the thing an ad promotes
       area: "suburb",   areas: "suburbs",         // geographic unit
     },
     nav: { items: [/* NicheNavItem[] */], mobileTabs: [/* exactly 4 */] },
     features: { adRadar: true, propertyCheck: false, suburbPages: true, guides: true },
     copy: { shell, home, leads, performance, adRadar, propertyCheck, settings, onboarding },
   };
   ```

3. **Flip the switch** in `src/config/niche/index.ts`:

   ```ts
   import { <vertical> } from "./<vertical>";
   export const niche = <vertical>;
   ```

4. **Run `npm run check`** and fix whatever the type-checker and governance tests flag.

That's the whole clone. No component, route, or CSS edits.

## 3. Field guide

- **`key`** — stable slug for the vertical; used anywhere a niche discriminator is needed.
- **`industry.audienceNoun(Plural)`** — the customer's peers ("what top **agents** are running"). This is where voice comes from; rewrite copy around it rather than find/replacing nouns.
- **`terms`** — swappable nouns for shared surfaces. `offer` = what an ad promotes (Blockwise: "listing"), `area` = the geographic unit (Blockwise: "suburb").
- **`nav.items`** — sidebar entries; optional `section` starts a grouped section, optional `feature` gates the item on a flag.
- **`nav.mobileTabs`** — the bottom tab bar; keep it to four.
- **`features`** — boolean gates. `adRadar`/`propertyCheck` hide both nav items *and* their routes (pages check the flag and `notFound()`); `suburbPages`/`guides` gate public marketing surfaces.

## 4. Do NOT touch during a clone

- **Components and routes** — they consume `niche.*`; editing them reintroduces niche nouns and defeats the clone.
- **`src/design-system/atlantic.css`, `src/app/tailwind.css`, and `src/app/globals.css`** — Atlantic is the single visual system.
- **Ad Studio** (`src/app/(customer)/ad-studio/**`, `src/components/adstudio/**`) — it consumes the same Atlantic tokens and components.
- **Landing / auth shell / operator / monitor** — not white-labeled.

## 5. Verification checklist

- [ ] `npm run check` green (type-check + the governance test suite, which asserts niche nouns stay out of components).
- [ ] `grep -ri "real estate\|agent\|listing\|suburb" src/app/\(customer\)/ src/components/ --include="*.tsx" -l` returns only files reading from `niche.*` (spot-check hits).
- [ ] Nav renders the new labels; feature-gated items disappear when their flag is off (also verify the gated routes 404).
- [ ] Charts/meters render with Atlantic running/data tokens; no route-local palette is introduced.
- [ ] `npx next build` exits 0.
- [ ] Mobile: bottom tab bar shows the four `mobileTabs`; no horizontal scroll at 320px.
