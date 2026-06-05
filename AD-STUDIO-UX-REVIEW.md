# Ad Studio UX Review — Mobile User Flow

Date: 2026-06-05
Scope: traced `src/components/adstudio/*` (workbench, panels, hooks, styles) and `src/app/api/adstudio/*` routes. Mobile = the `@media(max-width:900px)` branch.

## TL;DR

Mobile Ad Studio is a cut-down render of the desktop workbench that lost the core actions. On a phone you cannot upload media from the Media tab, cannot change any campaign setting, cannot save anything, and AI generation gives no visible result. Every long operation looks frozen. The three things reported are all confirmed code bugs, not user error.

---

## The three reported issues — confirmed

### 1. The dropdown at the top does nothing
`ad-studio-workbench.tsx` mobile campaign pill was a `<button>` with a chevron icon and **no onClick handler**. Dead UI that looks interactive. A campaign list endpoint already exists (`GET /api/adstudio/campaigns`), so a switcher is feasible — it was never wired.

### 2. Writing a brief and generating does nothing
Two compounding causes:

- **Success is invisible.** In "From a brief" mode the panel rendered only the textarea, the button, and a hint. The generated copy is written into fields that were only displayed in "AI copy" / "Write your own" modes, and the live preview is on a different tab (Ad). A successful generation changed *nothing on the screen the user is looking at* except a 2.4-second toast.
- **Failure is also invisible.** If `/api/adstudio/copy` fails (no provider key, trial limit 402, auth), the only signal was the same 2.4s toast — positioned overlapping the bottom nav and often behind the on-screen keyboard.

Success and failure were indistinguishable from "nothing happened."

### 3. Nowhere to upload an image on mobile
The mobile Media tab rendered `VariantStrip` instead of `MediaPanel`. The Upload card and image library existed only in the desktop panel. The only mobile upload path was the "Replace image" text button inside a generated-ad tile — mislabeled, easy to miss, and absent if there are no variants. Tapping the preview image sent you to this same upload-less Media tab, a dead-end loop.

---

## Worse problems found during review

### 4. Nothing done on mobile is ever saved
`saveDraft` is only wired to the top-bar Save button, which is hidden on mobile (`.studio-actions .secondary{display:none}` at <=900px). There is no autosave anywhere. The "Saving… / Saved" status is a fake 650ms timer that fires without any API call — and the status bar is hidden on mobile anyway. Edit copy, replace an image, generate from a brief, reload: all gone. (Mitigated now by Save draft in the mobile overflow menu; autosave still a follow-up.)

### 5. Campaign settings are unreachable on mobile
The mobile "Ad" tab shows only the preview. The goal/offer/market/property-type/destination form (`CampaignPanel`) was desktop-only. Defaults are hardcoded: market `"South Perth, WA"`, destination `"northstarrealty.com.au/free-appraisal"`. A mobile user literally could not change their suburb — which is why a brief saying "spearwood" still generates against `market: South Perth, WA`. (Mitigated now by the Ad details sheet from the campaign chip; seeding defaults from the live pack still a follow-up.)

### 6. Demo data leaks into live workspaces
The media "library" is four hardcoded stock images (`use-media.ts`), the default primary image is the demo Northstar shot, and the default destination URL belongs to the fictional demo agency. A real agent can export or publish with demo-tainted assets and URLs.

### 7. Every long operation looks frozen on mobile
The busy overlay renders inside `.studio-stage` within `.studio-desktop-body`, which is `display:none` on mobile. Regenerate, Export creatives, and first-ad generation give zero progress feedback on a phone.

### 8. The "sample workspace" banner is invisible
`.studio-screen` is `position:fixed; inset:0; z-index:100` and paints over `SampleBanner`. Users on the demo bundle have no way to know the data is fake.

---

## Smaller friction

- Story/Feed/Square tabs render on every mobile tab but only affect the preview, which is only visible on the Ad tab.
- "Ad" means settings-form on desktop and preview on mobile — same label, different things.
- Copy assist silently falls back to canned local text labelled "(offline)" on API failure — easily mistaken for real AI output.
- Brand, Templates, Audience, and Settings sections don't exist on mobile at all.
- Errors and successes share one 2.4s toast channel; messages like "AI copy is not configured…" vanish unread.
- Delete uses `window.confirm`; no undo.
- Desktop rail "Templates" item opens the New Ad dialog instead of the Templates panel.

---

## Fix order

### P0 — make mobile usable (shipped 2026-06-05)
1. **Media tab**: render `MediaPanel` (upload card + library) on mobile. ✅
2. **Brief mode**: keep copy fields visible with inline writing/success/error feedback. ✅
3. **Campaign chip**: opens an Ad details bottom sheet with the campaign settings form. ✅
4. **Mobile save**: Save draft exposed in the overflow menu. ✅ (Debounced autosave still recommended.)
5. **Settings on mobile**: reachable via the sheet. Seeding market/destination from `pack.campaign` instead of hardcoded demo values still a follow-up.

### P1 — feedback and trust
6. Global busy indicator outside the desktop-only stage (full-screen overlay or button-level states).
7. Persistent inline error surfaces for AI/trial failures everywhere (done for copy generation); raise toast above keyboard/nav.
8. Replace `MEDIA_ASSETS` with workspace media (brand-kit assets + previously uploaded images).
9. Fix SampleBanner stacking so sample users know it's sample.

### P2 — coherence
10. Show format tabs only where they apply; align "Ad" tab meaning across breakpoints; label assist fallbacks clearly; give mobile access to Brand/Templates; replace `window.confirm`.

---

## Target mobile flow (suggested)

Ad tab = preview + a settings sheet (goal/market/offer/destination). Media = upload-first, library second. Copy = brief → results appear inline under the button with Apply/Regenerate. Publish unchanged. One-thumb path: create → see → tweak → export, with every step visibly saving.
