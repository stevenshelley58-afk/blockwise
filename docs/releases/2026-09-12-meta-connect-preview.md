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
