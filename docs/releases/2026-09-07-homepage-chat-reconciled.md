# Homepage chat reconciliation, 7 September 2026

## Published preview

- URL: https://blockwise.sale/homepage-preview/concept
- Compiled application revision: `6e6e833c31d4f84b75747892887b889805841f8e`.
- Worktree: `/projects/blockwise-homepage-chat-reconciled-20260907`.
- Branch: `codex/homepage-chat-reconciled-20260907`.
- Container/image: `blockwise-homepage-preview-6e6e833c31d4` / `blockwise-homepage-preview:6e6e833c31d4`.
- Replaces the owner-rejected `f899d6815131138172f1bac90b07a8f0cc7dcb93` consolidation, without rewriting that history.

## Correction and evidence

See [the conversation reconciliation](../design/homepage-chat-reconciliation.md) for the individual task IDs and source of each retained section. The workflow and native Meta gallery are separate requirements. The owner did not request deletion of deeper examples, control details or the FAQ subheading.

The page now contains, in order: hero, full workflow, reporting, original examples, original control accordions, FAQ and trial form. It retains the latest hero/reporting revisions and the exact FAQ subheading. The invented replacement typing-ad section is not included. The original footer Pricing link remains, and the historically requested Log in link is visible on mobile and desktop.

The workflow is adapted from the existing isolated process iteration. The restored animation scrolls/selects templates, moves the selected creative into the editor, edits copy and creative text, moves into review, fills campaign values, simulates the approval press and finishes green before looping. Distinct stages prevent the approval state from appearing before the review values. A matching existing townhouse asset is reused for the requested distinct ad. No new dependencies or live integrations were added.

## Checks

- `npm run check:nul`: passed.
- `npm run test`: passed. TAP groups: 838/838, 73 passed plus 1 pre-existing skip, 11/11 and 17/17. No failures.
- `npm run typecheck`: passed.
- Preview `npm run build`: passed with exact compiled revision.
- Focused reconciliation/workflow tests: 8/8 passed, including section order, retained FAQ copy, full phase ordering, continuous looping/motion guards and pre-hydration form protection.
- Final CSS-only correction restored the original studio topbar styling and scoped the workflow image aspect ratio so the shared ad CSS cannot clip the creative. NUL, focused tests, production build and browser checks passed after this correction.
- `git diff --check`: passed.

## Browser acceptance

Chrome verified the public, production-built route and exact revision, not a local development server.

- Seven sections and original order verified from rendered DOM.
- Widths 320, 390, 768, 950, 1100 and 1440: no document horizontal overflow. Tablet process layout stacks before the desktop minimum columns can overflow.
- Desktop editor and review creative, link area and panel fit fully inside the workflow frame after the CSS correction.
- All nine workflow states sampled through the normal continuous loop on desktop and mobile. Empty review values become populated, the approval press precedes the green finish, and the sequence returns to template browsing.
- Keyboard Choose/Customise/Review seeks work without permanently stopping the loop.
- Reduced-motion page load shows the completed green state without automatic progression. Manual step selection remains available.
- Without JavaScript, all seven sections and static workflow remain visible, while email input and submit button remain disabled with the required instruction.
- 7/30-day reporting selection works, with weekday labels on the week view and sparse legible month labels on narrow screens. Existing reporting source was retained unchanged.
- Original example tabs change selection; mobile product details start collapsed.
- Control and FAQ accordions work by keyboard; six FAQ answers and the exact retained subheading are present.
- Empty trial email produces validation. A fake example address produces the explicit mock-success message without a query-string submission. All observed page resource requests were same-origin; no application console errors. Unrelated browser-extension warnings were excluded.
- Observational browser navigation timing before correction: DOMContentLoaded 16.18s / load 16.27s. After restoration: 2.28s / 5.55s. Cache/network conditions were not controlled; these are observations, not a claimed benchmark improvement.

## Hosting safety

- Public GET 200 with the exact compiled revision; no-index and no-store headers.
- Preview POST 405; preview API path 404.
- Candidate container response and public response matched byte-for-byte.
- Full router objects outside the homepage-preview route compared equal before/after both switches.
- Secret-free, read-only, unprivileged container on the existing preview network. No product deployment or provider writes.
- Production readiness passed for `f972e44d4ee1a47c1602e1427883835512240fce`; production health revision remained unchanged through this preview deployment.

Reapply only this preview route if the product router is restarted:

`python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-6e6e833c31d4:3000 --apply`

The preceding pre-consolidation preview container `blockwise-homepage-preview-bac4d1372543` remains available for recovery. Do not restore an old full router configuration over concurrent product work.
