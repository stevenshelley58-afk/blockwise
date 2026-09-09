# Homepage workflow rebuild, 8 September 2026

## Published revision

- Preview: https://blockwise.sale/homepage-preview/concept#how-it-works
- Compiled source: `5f7226d4a9fa4770c7b118aa554b2e50ab649886`.
- Container/image: `blockwise-homepage-preview-5f7226d4a9fa` / `blockwise-homepage-preview:5f7226d4a9fa`.
- Source retained: `/projects/blockwise-homepage-chat-reconciled-20260907`, branch `codex/workflow-continuity-20260908`.
- Rollback retained: `blockwise-homepage-preview-6e6e833c31d4`, source commit `6e6e833c31d4f84b75747892887b889805841f8e` in the same repository history.

This is historical release evidence, not a replacement for the current canonical engineering or production verification guides.

## Owner request and implementation

The owner retained the choose, edit, review and approve progression but rejected its appearance and continuity. Specifically: remove the selection cursor, smooth the selections and handoffs, replace the oversized creative text, and retain the template section through the entire flow.

Only the workflow component, its stylesheet, its isolated fixtures and focused tests changed. The hero, reporting, examples, controls, FAQ, form and other page content remain unchanged.

The old conditional scenes, duplicate ad mounts, shared-layout projection, blur transitions and simulated pointer are removed. One persistent studio contains one ad, one template rail and one inspector. Panel crossfades change the task without rebuilding the creative. All three templates remain visible in every stage. Mobile has a horizontal template strip, readable ad and a compact inspector underneath instead of a squeezed desktop layout.

A reusable DOM creative uses an existing townhouse photograph, restrained agency branding, an address, suburb and property facts in a dedicated dark footer. These are preview fixtures, not a customer template pack or an actual property listing. Copy and headline edit in fixed-height boxes. A brief button press precedes the green completion state. Longer editing and completion holds replace the rushed transitions. No new dependency, provider integration, image-generation service or backend write is involved.

## Checks and observations

- `npm run check:nul`: passed.
- `npm run test`: passed. Groups: 838/838; 74 passed plus one existing skip; 11/11; 17/17. No failures.
- `npm run typecheck`: passed.
- Preview production `npm run build`: passed at the compiled revision above.
- `git diff --check`: passed.
- Pure fixture tests cover all nine phases, selection persistence, edit/review/approval order, loop wrapping and useful timing holds. Component regression checks protect the single ad/rail structure and mock-only visibility/motion guards.
- Before rebuild: a 9-second browser sample observed three ad mount changes and 21 review samples without the template rail.
- Rebuilt desktop and phone loops: all nine phases observed, zero ad/rail replacements, no missing template rail and no ad/panel overlaps. A 14-second mobile sample found no empty inspector frames. The final published revision was sampled again through all nine phases with zero ad/rail replacements.
- Desktop and phone visuals inspected, including the finished creative and green approval. The large white text overlay is gone.
- Widths 320, 390, 601, 740, 768, 950, 1100 and 1440: no document horizontal overflow and no clipped ad, template rail or inspector.
- Keyboard step selection remains available. The loop pauses offscreen. Live changes to reduced-motion preference move directly to a stable completed state; manual step selection remains possible.
- No-JavaScript: the ad and three templates remain visible; the existing mock form stays disabled.
- Browser application error log: empty. Existing photographs all loaded.
- The corrected initial appraisal caption/CTA matches the initial template, before selecting the property listing.

## Hosting and retention

- Candidate and public responses matched byte-for-byte with the exact compiled revision; all seven homepage sections remained present.
- Preview GET 200, no-index/no-store headers, POST 405, preview API 404.
- Non-preview router configuration compared equal before/after both preview switches.
- Production health stayed at `f972e44d4ee1a47c1602e1427883835512240fce`; the current maintained product-health script passed for that exact revision. No live product deployment or provider writes were performed.
- The live container is healthy, secret-free, read-only and unprivileged on the existing preview network, without a source bind mount.
- Intermediate task container/image `c00834d583f7` was retired after verifying that no route or remaining container used it. The live and documented rollback containers/images remain protected.
- Check/build/public-response evidence is retained under `work/workflow-continuity/` in the source workspace. Regenerable local build/dependency directories are removed after checking active consumers; source, Git history and evidence remain.

Preview-only reapply, if needed after a router restart:

`python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-5f7226d4a9fa:3000 --apply`
