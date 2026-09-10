# Ad DB delivery — 2026-09-06

## Required outcome

One canonical research database, Frank operator UI, Blockwise research UI, outreach filtering by agent/agency/location. Save actual images/videos while reachable; source URLs are provenance, never playback fallback. Preserve inactive ads and their files. Zero AI is the ingestion default.

## Live now

- Existing `blockwise-research-db` remains the only canonical database.
- Private authenticated PostgREST: `http://127.0.0.1:8652/rest/v1`. Anonymous requests return 401. Infrastructure release: `/srv/blockwise/releases/ad-db/a4ff3eda70999d6487aa9112ff0f3b794473c8f0/`.
- Migrations 008, 009 and 011–014 applied with checksums. No 010 exists; the numbering gap is intentional.
- Inactive purge is a retention no-op. Miss/seen/miss resets correctly; partial/older scans cannot advance lifecycle state. No invented delivery dates or historical-sighting reactivation.
- Read projections: 4,464 ads; 15,946 prospect/page rows (not distinct people). **0 verified archived assets**. Historical captured labels are not accepted as proof that files still exist.
- No ScrapingBee credits spent in this build. Seeded budget rows are not verified provider balances.

## Implemented source

- Archive root `/srv/hermes/ad-db/assets/sha256/<SHA256>`; hash deduplication, bounded download/disk checks, allowed source hosts, image pixel decoding and first-video-frame decoding.
- Media collector invokes the actual archive worker, checks ad-scoped archive metadata, does not overwrite it with legacy public-bucket paths, and does not queue AI. Refreshes preserve verified captures.
- Durable credit-attempt ledger: account and run caps, concurrency locking, idempotent reserve/settle, paid failures counted, unknown charges consume the full hold.
- Hermes authenticated read/filter/media API; scoped GET/HEAD token for Blockwise, separate from operator access. Config under `ad_db.rest_url` and `ad_db.archive_root`; secret `HERMES_AD_DB_READ_TOKEN`, sent as `X-Hermes-Ad-Db-Read-Token`.
- Frank proxy streams stored media including HEAD/range/ETag; rejects external redirects and hotlink fallback.
- Collector ledger wiring and Blockwise consumer integration were still in progress at this checkpoint; see subsequent commits. UI, scan trigger and full release are not yet complete.

## Verification

- `AD_DB_SQL_TEST=1 node --test tests/ad-db-lifecycle-db.test.mjs`: real SQL rollback lifecycle regression passed.
- `docker exec -i blockwise-research-db psql -q -U postgres -d blockwise_research -v ON_ERROR_STOP=1 < supabase/tests/ad_db_archive_native.sql`: native archive permissions/idempotency/conflict/ownership/location assertions passed and rolled back.
- `node --test tests/media-archive.test.mjs tests/ad-db-media-integration.test.mjs`: 7 passed, including generated valid PNG/MP4 files retained after the source disappears, corrupt pixel/video rejection and actual collector/archive bridge calls.
- Ledger helper: 4 passed. Isolated PostgreSQL ledger suite: 15 passed, including concurrent reservation and repeat settlement. Typecheck passed. Full repository tests: 869/870; unrelated unwritable-workspace hard-reset contract failed.
- Hermes: 10 targeted tests passed; live ASGI to real PostgREST returned 200; wrong token and read-token POST returned 401. Frank: 6 targeted proxy tests passed.
- Frank full verification: 1,070 tests, three unrelated dirty-tree failures (two knowledge-source checksums, one obsolete infrastructure workflow assertion), 11 skipped. Do not bypass the failures.
- Private live DB probes returned 200 for ads, Perth prospects and WA service-area filtering (three-row samples, 12–46 ms; not a load benchmark).
- Two old source URLs, one image and one video, returned 403. Successful retention tests used generated fixtures, not a freshly scraped ad. No paid retry was attempted.

## Finish / blockers

1. Finish and test paid-path ledger wiring and canonical Blockwise search/detail/media consumption. Keep feature gates until demonstrated end-to-end.
2. ScrapingBee key was absent from inspected runtime settings and matching metadata in the configured Frank vault. Add through the secure connection workflow; authenticate `/usage`. Never assume the seeded 1,000-credit balance is real.
3. Browser access to Frank returned `ERR_BLOCKED_BY_CLIENT`; unauthenticated VPS HTTP returned 401. Authenticated browser inspection is required for UI work and release verification. Do not weaken authentication.
4. Preserve unrelated Frank edits; fix/resolve its full-suite failures through their owning work. Deploy only validated committed Hermes/Frank/product revisions via existing release processes. Hermes and Frank API changes are not deployed at this checkpoint.
5. Complete Frank Ads/Prospects/Runs controls in its incumbent design. Show ownership versus agency affiliation, office/service-area/property/copy-mention/actual-targeting provenance, freshness, missing assets and cost ceiling. Do not imply property location is ad targeting.
6. The scan endpoint is still unavailable and live pilot disabled at this checkpoint. A trigger must create one bounded idempotent run with explicit Page IDs, never drain historical queues. No generic supervisor service should be started.
7. After key/config/deployment checks, start a canary capped at 50 credits, not 800. Require actual archived media where sampled ads supply it; verify playback after source unavailability, repeated-import deduplication, search and budget accounting through live routes. Stop on unexplained charges or incomplete coverage.
8. Verify archive bytes are included in off-host backup before bulk fill; a database backup does not protect media files. Capacity planning and restore verification remain required.
9. Estimate fill/refresh from measured complete-page credits, pagination, failures and media bytes. Default zero AI, unique Page IDs, priority outreach areas first, active pages fortnightly, confirmed zero pages monthly, failures backed off. Keep coverage/freshness visible.
10. Outreach lists need distinct agents/agencies, contactability and suppression controls. Private contacts must not enter customer ad responses. No outreach messages are sent by this build.

## Recovery

Pre-change backup `/srv/blockwise/backups/research/ad-db-prebuild-20260905T1545Z.dump` is 1.7 GB; restore listing and SHA256 checks passed. Preserve it. No user scraper or historical ad records were deleted.
