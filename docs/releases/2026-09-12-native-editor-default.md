# Native editor default, 12 September 2026

## Change

- Removed the trial-copy footer and original-ad link from the native editor.
- Normal ad URLs now open the simple-first native editor. A mounted client calls the existing idempotent copy POST; server reads and link prefetch remain read-only.
- Preserved source ads and previous editor code. Explicit original-ad URLs with ?editor=legacy are the recovery route. Native scene/identity guards run before that escape hatch.
- New copies retain their source name.
- Fixed native word wrapping and initial font fitting after the visual contact-sheet review exposed broken headings. Native text stays editable; initial fit honors the pack line limit and truncate policy without shrinking below its readability floor. The transient fit marker is removed before saving, so reopening never refits customer edits. Pack line leading is converted to Fabric units.\n- Fixed bundled template font loading and allowed declared binary fonts through the existing authenticated template asset route.

Impeccable distill/layout guidance: retain the approved desktop secondary left tool rail, single mobile tool row, and realistic ad preview. No new settings or migration choice in the ordinary flow.

## Observed checks

- Production build and TypeScript passed.
- Root suite: 1,031 passed.
- Focused Ad Studio suite: 159 passed.
- Package suites passed.
- Actual React launcher browser harness passed automatic POST, StrictMode duplicate guard, error, retry, redirect and reopen.
- Host browser harness passed desktop 1440px, mobile 390px and 320px, footer absence, Photos, Words, explicit AI proposal application, native edit roundtrip, save failure/retry/reopen and review navigation.
- Bundled Vue bridge browser harness passed strict CSP, exports and roundtrips.
- Unrelated existing infrastructure failure quarantined: tests/meta-ad-lifecycle-migration.test.mjs expects an older Ad DB worker pagination source expression. Neither that test nor its worker was changed by this release. The infrastructure run had 230 passes, one failure and two skips.
- These editor harnesses use mocked account/API boundaries. They are not authenticated production acceptance and did not create a Meta campaign or make a paid AI call.

## Template evidence

The read-only all-template harness uses current active template rows, declaration-checked real storage assets, bundled/declared fonts, the actual native bridge, both full-sized PNG exports, and saved-scene reopen comparison. Observed complete inventory verification: 61 templates passed the full batch and the corrected coastal template passed a targeted rerun, covering all 62 current active templates, with 124 full-sized Feed/Story PNGs. Every declared font loaded and all 124 exports were pixel-identical after reopening their saved native scenes. Reports, images and visual contact sheets are retained at /root/work/adstudio-templates-release on the VPS. Earlier incomplete harness attempts are not acceptance evidence. It does not mutate template or customer rows.
