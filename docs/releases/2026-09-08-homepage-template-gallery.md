# Homepage template gallery, 8 September 2026

Historical preview release. Application revision: `c1d33bc534f4d9f49ae82bcabf5ea2d6886ea4c8`.

Replaced the single-example explanation panel with a two-column gallery of the four existing ad creatives, category filters, a clear headline and trial links. Mobile uses one column. Removed the retired example layout CSS. Existing FAQ, workflow and reporting changes are retained. This is frontend-only: template links lead to the existing mock trial form, not a connected editor or campaign.

- Public route: https://blockwise.sale/homepage-preview/concept#examples
- Container: `blockwise-homepage-preview-c1d33bc534f4`
- Image: `blockwise-homepage-preview:c1d33bc534f4`
- Immediate retained rollback: `blockwise-homepage-preview-0cb241f44bb9`
- Source: `/projects/blockwise-homepage-chat-reconciled-20260907`
- Isolated exact-revision build and evidence: `/projects/blockwise-gallery-build-20260908/work/gallery/`

Checks: NUL check, typecheck, production build and full test command passed. Tests: 943 passed, one existing root-only filesystem-permissions skip, zero failed. Public HTML matched candidate HTML and its compiled revision; all seven homepage sections remained. The Caddy comparison showed only the homepage preview route changed. Main product health passed at `674b512139961927191f3659a64737a2e0db1cdd`.

Browser review: desktop 1440px and phone 390px inspected visually. At 320px all four gallery cards remained accessible, filter controls were at least 44px high and no horizontal overflow occurred. All category filters and the return to All templates worked by keyboard. The template action reached #trial. All four existing images loaded. No browser errors were reported. Temporary viewport overrides were cleared.

No provider writes, product deployment or backend integration occurred. Build dependencies and generated outputs were retired after checking for active consumers; source, evidence, live image/container and rollback remain.
