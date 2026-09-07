# Canonical ad-template generation and editing

## Serving revisions

- Blockwise: `447d05568b22bfb4ae138b70b083d74c12d67b6c`, app-only immutable image.
- Frank: `2dc77e27e96aeb7225887cf1b5c23842e45c5a2e` (PR 145).
- Hermes generator: `a11673d0486725c3758911eb657203cc3806eac3`, gateway PYTHONPATH release override.
- Generator renderer remains `39e51fedafbdc7a8ce189f3e944a4f3ab35b8058`. Both shared package source trees are byte-identical to this Blockwise release; no renderer upgrade was needed.

## Changes

Authenticated, workspace-owned previews now render the canonical AdDocument using the same image resolver and renderer as saves. Feed, Story, Design, Meta and split previews share server PNGs. Debouncing, aborts, stale-response rejection and URL cleanup preserve editing. Template hashes come from the immutable template JSON.

Hermes runs four bounded reusable-content scenarios (short, max-length, Unicode/crop and empty text), caches matching evidence, persists failures and honors cancellation between renders. This is renderability evidence, not visual-likeness approval. Existing dual reviews, quarantine, manual approval and publishing gates remain intact.

Frank separates faithful reconstruction from reusable-template evidence and provides the Upload → Generate → Compare → Edit/approve workflow and valid editor handoffs.

## Verification

- Blockwise: check:nul and typecheck passed; 948 tests passed, 0 failed, 1 existing root-permissions test skipped. Production image built successfully. The existing optional postcode-data build warning remains unrelated.
- Behavioral parity test uses real saveAd rendering and captured storage uploads: Feed and Story PNGs equal their canonical previews, and text edits change the output.
- Dedicated test-ad browser check passed on both the private final candidate and public release (10.9s and 9.3s). It blocks save, publish and provider POST requests.
- Hermes: 72 tests passed through the required hermetic runner; four real shared-CLI scenarios also passed during implementation. No new model-generation approval is claimed.
- Frank: full verifier and container builds passed; Python suite ran 1,057 tests with 11 skipped. Authenticated live workflow and run history were checked.

## Release safety

Release branch is based on the serving product line, not divergent customer-operations main. The intervening homepage release `6ee635b3416ee694badc3d5b8f2ea99a9981be13` is included. No product data migration, provider enablement, ad approval or publishing was performed. Existing failed generation runs were not rerun.

Immediate Blockwise rollback image: `blockwise-app:6ee635b3416ee694badc3d5b8f2ea99a9981be13`. Protected env backup and release script: `/srv/blockwise/e2e-runs/ad-template-20260907/release/`. Hermes override backup: `/srv/hermes/releases/ad-template-20260907/only-ad-template-process.before.conf`. The prior Frank release remains retained.

Live readiness verifies the compiled Blockwise SHA. Browser evidence and logs are retained under `/srv/blockwise/e2e-runs/ad-template-20260907/`.
