# Template editor and customer usability release

Deployed 6 September 2026 (Australia/Perth), app only.

- Serving source: `3b2770eb4dec62217589b074be999ae9fa9fda06`.
- Image: `blockwise-app:3b2770eb4dec62217589b074be999ae9fa9fda06`.
- Image ID: `sha256:f787e10b3dc8cbf8e4213393a9e96907d3f30c2b8c0fc54c30d436c4b5c0689a`.
- Previous serving source: `d39771a94134c28081185bcf93a8d5e1947a39a4`.

This combines shared browser/export text layout, authenticated template fonts,
strict renderer input validation, Studio navigation/brand-logo recovery, clearer
publish controls, enquiry-first reporting and honest missing/demo data states.
Blockwise design tokens and provider-write controls are preserved.

Verification: integrated source 924 tests passed, typecheck/NUL/build passed;
the final change only scopes an E2E locator to the active main view. Six canary
browser tests and six public production browser tests passed. The final image
passed revision-pinned canary health and public readiness checks. Mobile brand
and reporting screenshots were inspected. No database migrations, provider
activation, worker changes, or research/media changes were performed.

Evidence and deployment harness: `/srv/blockwise/e2e-runs/focused-cleanup-20260906`.
Protected rollback environment: `release/product.env.before-3b2770eb4dec` under
that directory. The previous immutable image is retained. Rollback restores that
protected environment and recreates only `product-app`, then verifies the prior
revision; do not reset database or storage volumes.

Limitation: no active/quarantined template or customer ad existed during release
QA. Real template editor save/reload/export still requires the generator pilot
to pass its quality gate and import into quarantine. Navigation success is not
evidence that a template was approved or that Meta publishing was exercised.
