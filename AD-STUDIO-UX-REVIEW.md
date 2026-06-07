# Ad Studio UX Review - Mobile User Flow

Date: 2026-06-05
Scope: traced `src/components/adstudio/*` (workbench, panels, hooks, styles) and `src/app/api/adstudio/*` routes. Mobile = the `@media(max-width:900px)` branch.

## TL;DR

Mobile Ad Studio had a cut-down render of the desktop workbench that lost core actions. On a phone, users could not upload media from the Media tab, could not change campaign settings, could not save directly, and AI generation gave little visible feedback. The three reported issues were confirmed code bugs, not user error.

---

## The three reported issues - confirmed

### 1. The dropdown at the top did nothing

The mobile campaign pill was a `<button>` with a chevron icon and no useful action. It now opens the Ad details sheet so mobile users can reach the campaign settings form.

### 2. Writing a brief and generating looked like nothing happened

Two compounding causes:

- **Success was invisible.** In "From a brief" mode the panel rendered only the textarea, the button, and a hint. Generated copy was written into fields displayed in other modes, while the preview was on a different tab.
- **Failure was also too easy to miss.** Provider, trial-limit, and auth errors were toast-only and disappeared quickly.

Brief mode now keeps editable copy fields visible and shows inline feedback.

### 3. There was nowhere obvious to upload an image on mobile

The mobile Media tab rendered generated variants instead of the real media panel. The upload card and library existed only in the desktop panel. The mobile Media tab now renders the real `MediaPanel`, including upload, paste/drop validation, and image library selection.

---

## Worse problems found during review

### 4. Mobile edits were not directly saveable

`saveDraft` was only wired to the desktop top-bar Save button. Mobile now exposes Save draft in the overflow menu. Debounced autosave remains a follow-up.

### 5. Campaign settings were unreachable on mobile

The mobile "Ad" tab showed only the preview. The goal, offer, market, property type, and destination form was desktop-only. The campaign chip now opens an Ad details sheet with the campaign settings form.

### 6. Demo data could leak into live workspaces

The original media library and default destination were demo-first. Follow-up work replaced more of the flow with server-owned brand-kit/media handling, but workspace media beyond the current upload path should continue to replace stock fallbacks.

### 7. Long operations looked frozen on mobile

The busy overlay was inside the desktop-only stage. Mobile now has more reachable action feedback, but global operation feedback should continue moving outside desktop-only containers.

### 8. The sample workspace banner could be hidden

The fixed Ad Studio screen could paint over `SampleBanner`. Keep sample-state visibility in mind when changing shell stacking.

---

## Smaller friction

- Story, Feed, and Square tabs render on every mobile tab but only affect the preview.
- "Ad" means settings form on desktop and preview on mobile.
- Copy assist fallbacks must stay clearly labelled as non-provider output.
- Brand, Templates, Audience, and Settings sections are still mostly desktop-led.
- Delete uses `window.confirm`; there is no undo.

---

## Fix order

### P0 - make mobile usable

1. **Media tab**: render `MediaPanel` with upload and library on mobile. Done.
2. **Brief mode**: keep copy fields visible with inline writing, success, and error feedback. Done.
3. **Campaign chip**: open an Ad details bottom sheet with campaign settings. Done.
4. **Mobile save**: expose Save draft in the overflow menu. Done.
5. **Settings on mobile**: reachable through the Ad details sheet. Done.

### P1 - feedback and trust

6. Move all long-operation busy indicators outside desktop-only containers.
7. Keep persistent inline error surfaces for AI and trial failures.
8. Continue replacing stock media fallbacks with workspace media and brand-kit assets.
9. Keep sample workspace state visible above the fixed workbench shell.

### P2 - coherence

10. Show format tabs only where they apply.
11. Align the "Ad" tab meaning across breakpoints.
12. Give mobile access to Brand and Templates.
13. Replace `window.confirm` with an undoable destructive-action flow.

---

## Target mobile flow

Ad tab = preview plus a settings sheet. Media = upload first, library second. Copy = brief to inline editable results. Publish unchanged. One-thumb path: create, see, tweak, export, with every step visibly saving.
