# Pricing race-recovery release

After a stale guides deployment reverted pricing, pricing was re-integrated onto live `f21043fff1af0a0ad63eff813f16dbf71952c87a` and deployed app-only.

- Final source/image revision: `9b5946a23872cde7dc571e9d79e4b0c7abf16f11`
- Public health verified exact revision and `/pricing` contains the new heading.
- Provider writes remained disabled; worker omitted.
- Rollback env: `/srv/blockwise/e2e-runs/pricing-live-20260907/release/product.env.before-9b5946a23872`
- Final integrated checks passed: root 875; package suites 63 passed/1 skipped, 11/11, 17/17; zero failures.
