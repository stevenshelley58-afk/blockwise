# Choose to customise motion study, 12 September 2026

This is an isolated, noindex preview study. It does not change the production homepage or existing concept preview.

## Preview

- URL: https://blockwise.sale/homepage-preview/motion-study?rev=bf3898
- Source revision: `bf38984fd6da39ecf3b057098e97847057c35b76`
- Image/container: `blockwise-homepage-preview:bf38984fd6da` / `blockwise-homepage-preview-bf38984fd6da`

## Verification

- `check:nul`, typecheck, production preview build and seven focused study tests passed; the focused existing homepage regression set passed 35 tests.
- Candidate container revision, health, non-root user, read-only filesystem, dropped capabilities, internal network and no host ports verified.
- Public study GET returned 200 with noindex/no-store; POST returned 405 and preview API health 404.
- Existing concept GET and product health returned 200 before and after the preview-only route switch.
- Browser acceptance passed at 1440x900, 390x844 and 320x800. The same ad DOM node persisted through Choose to Customise; fields fit, mobile had no horizontal overflow, reduced motion settled on the final editing layout, and console errors were empty.

## Rollback and cleanup

The prior `53bf` and `6b716` task-owned preview containers/images were retired after acceptance. The final `bf389` preview remains running for review. No production or main deployment was performed.
