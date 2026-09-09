# 8 September 2026: Home asset-loading incident

Historical release evidence, not a permanently current version claim.

## Observation

The user's live Home tab displayed unstyled HTML, then a recoverable runtime error. Direct inspection found all three current stylesheet links without loaded sheets and Times New Roman on the body. The main current CSS request recorded status 0 after about 32 seconds; several current JavaScript requests recorded status 0 after about 62 seconds. The root service worker controlled the tab with the v4 static cache. A normal reload restored the styled Home. The initiating failure was not captured conclusively. Old missing asset URLs do not establish stale HTML as this incident's cause: the affected tab requested current hashes.

## Released correction

Application/image revision: 031bf62a76fe2aa44276296e76a9b2e5703f62a3.

Cache reads now fall back to network when cache access fails. Successful network asset responses no longer await cache writes or eviction. Guarded background maintenance cannot reject usable responses. Response cloning occurs synchronously, before asynchronous cache work. Named-cache lookup excludes unrelated origin caches. This fixes a verified resilience defect without claiming it conclusively initiated the screenshot incident. No UI design, account data, template activation, provider-write gate or worker setting changed.

## Verification

- NUL check, full tests and typecheck passed. 1,094 tests: 1,092 passed, two existing environment skips, zero failures.
- Eleven focused PWA tests passed, including cache read/write/eviction failures, pending writes, network failure, cache hits and response-clone timing.
- Exact-SHA protected-configuration production image built successfully.
- Authenticated canary and public service-worker lifecycle acceptance passed: active controller, all three CSS files HTTP 200 with loaded stylesheet objects, and Inter on first load/reload.
- Canary Home suite: seven passed on unchanged confirmation. Initial run had one transient duplicate marker at 375px. No assertion was weakened.
- Public Home suite: seven passed. Public exact-SHA product-health passed.
- An expired test session was replaced using the dedicated fixture account's existing password login, without changing the account.
- Canary SW testing needed a certificate exception in its isolated headless browser. Public verification used normal TLS.

## Evidence and rollback

Evidence: /srv/blockwise/e2e-runs/home-css-incident-20260908/
Rollback image: blockwise-app:2401cbfcfb56f7dadd64af70bb49eecb93fa6567
Protected mode-600 backup: /srv/blockwise/e2e-runs/home-css-incident-20260908/release/product.env.before-031bf62a76fe2aa44276296e76a9b2e5703f62a3

App-only deployment changed only the persisted image/revision keys. Other services and preview routes were preserved.
