# Pricing race-recovery release

After a stale guides deployment reverted pricing, pricing was re-integrated onto live `f21043fff1af0a0ad63eff813f16dbf71952c87a` and deployed app-only.

- Final source/image revision: `9b5946a23872cde7dc571e9d79e4b0c7abf16f11`
- Public health verified exact revision and `/pricing` contains the new heading.
- Provider writes remained disabled; worker omitted.
- Rollback env: `/srv/blockwise/e2e-runs/pricing-live-20260907/release/product.env.before-9b5946a23872`
- Final integrated checks passed: root 873; package suites 64 tests (63 passed, 1 skipped), 11/11, 17/17; zero failures. Logs: `/tmp/race-test`, `/tmp/race-build`.
- Final browser QA passed at 1280, 390, and 320 widths with Essential-only cookies: stable prices, no overflow, keyboard FAQ close/open, 15 FAQs, all detail anchors, managed enquiry CTA, and Perth mailto subject verified without sending. Evidence: `/srv/blockwise/e2e-runs/pricing-live-20260907/review-browser.log`, `live-{1280,390,320}-top.png`, and `live-{1280,390}-faq.png`.
