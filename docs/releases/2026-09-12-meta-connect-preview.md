# Meta Connect preview, 12 September 2026

## Published preview

- Public URL: https://blockwise.sale/meta-connect-preview
- Redirect: `302` to `/meta-connect-preview/concept/meta-connect`; preview response: `200`.
- Compiled SHA: `4465a4212f17db389fa67ba71f4372c2d0f724ea`; final source HEAD `763d81a6a` (test-timeout adjustment only).
- Container/image: `blockwise-meta-connect-preview-4465a4212f17`.
- Retained worktree: `/worktrees/meta-connect-preview-20260912`, branch `codex/meta-connect-preview-20260912`, pending owner decision.

## What shipped

An isolated three-step Meta sharing preview using existing Blockwise neutral/ink Manrope/Inter and shadcn language. It demonstrates public Business ID, external Meta Settings, minimum Page/ad-account access, optional Instagram/pixel, and missing/waiting/connected states. Continue is local only; Harbour & Home names are fictional. No provider/API/storage/auth/analytics call or production deployment was made.

## Verification

- Public E2E `10/10` pass in `11.1s`; focused tests `4/4`; typecheck and Next build pass; detector `[]` (single run).
- Review PNGs: `review/meta-connect-preview-{user-desktop-1920x1031,desktop-1440x1000,mobile-390x844,narrow-320x740}.png`.
- No-index/no-store, CSP `self`, APIs `404`, non-GET `405`, internal network `blockwise-meta-connect-preview` only; readonly/unprivileged runtime.
- Evidence: `/srv/blockwise/previews/meta-connect/{build.log,image-build.log,e2e.log,detector.json}`.

## Review and routing

Fresh finish review: **SHIP** for the visible preview, no material fixes. gpt-5.6-luna handled UI/E2E/finish review/docs; gpt-5.6-terra handled backend audit/preview isolation; parent Astra handled integration/security review. No measured cost claims.

## Retention and future gate

Retain the named preview container, image and worktree until accepted or declined. Do not execute cleanup here. Actual integration remains gated on workspace-verified asset correlation, capability checks, system-user assignment, lead access and Meta app approval.

## Revision 2 final deployment

- Compiled source SHA: `6f88f83e5a06ef146cd0052e9203be7cfe56b5c1`.
- Container/image: `blockwise-meta-connect-preview-6f88f83e5a06`.
- Public page: HTTP `200`; `X-Preview-Revision` matches the compiled SHA.
- Revision 2 is the simplified four-panel flow with responsive 4/2/1-column
  layout, shorter copy, scoped data-blue CTA/number/icon accents, closed
  walkthrough below the panels, and the simulation selector below it.
- The walkthrough uses four actual Meta screenshots with captions covering
  Manage campaigns and View performance while Full control remains off.
- Review disposition: **SHIP**, limited to the observed 1440px and 390px UI;
  no material fixes.
- Build and image evidence: `/srv/blockwise/previews/meta-connect/{build-v2-final.log,image-build-v2-final.log}`.
- Detector v2: `[]` (single run). Focused tests `4/4`, typecheck and build
  passed. Final public E2E: `11/11` pass in `31.0s`, all first attempts with
  no retries; no app/page errors were observed.
- Browser diagnosis: `/srv/blockwise/previews/meta-connect/browser-network-diagnosis-v3.log`.

## Revision 3 final deployment

- Compiled source SHA: `1e7487192d3162175a21f57fe2b41ea822b48e67`.
- Container/image: `blockwise-meta-connect-preview-1e7487192d31`.
- Public E2E: `11/11` pass in `11.2s`, first-attempt results with one worker
  and no retry used; focused tests `4/4`, typecheck and Next build pass.
- Detector v3: `[]` (single run). CUA verified one panel expander opens while
  the other three remain collapsed.
- Each of the four numbered panels now owns its `Show me how` expander and
  screenshot: (1) Partners, (2) Give access plus Business ID, (3) permissions,
  and (4) Assign assets as the final step, with an explicit return to the
  example preview check. Full-size images are clickable and summaries retain
  44px-class controls. The global walkthrough was removed.
- Per-panel test hooks are `meta-step/step-help1` through `step-help4`.
- Evidence: `/srv/blockwise/previews/meta-connect/{build-v3.log,image-build-v3.log,e2e-v3.log,detector-v3.json}`.
- Parent visually checked desktop/mobile, closed and expanded states; no further
  corrections were made. No assets were added and no provider changes were made.

The revision 3 container/image is the retained preview artifact pending owner
decision; the earlier revision 2 container/image has been retired. Actual Meta
integration remains separately gated as described above.
