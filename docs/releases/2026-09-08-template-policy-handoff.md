# Template policy handoff, 8 September 2026

Historical release evidence; current policy remains in
/projects/frank/docs/AD_TEMPLATE_GENERATOR.md and deployment procedure in
docs/runbooks/production-readiness.md.

Live base 031bf62a76fe2aa44276296e76a9b2e5703f62a3 rejected the generator's
current review policy with HTTP 422 invalid_template_artifact. The existing
three-file cbc3f92e0 policy change was cherry-picked onto that exact base,
preserving all newer product work. No database/schema migration or UI change.

Release e09a5d6f9b141c2613d914e293c1d4bfd9521a00 deployed app-only at
09:42:34 UTC. Image blockwise-app:e09a5d6f9b141c2613d914e293c1d4bfd9521a00,
image ID sha256:4042a5068dd11dda3ffbe25e6700e284169bce9ec6326e7d3761ef59543c5906.
npm ci, check:nul, full npm test, typecheck and protected-public-config Docker
production build passed. Exact final artifact validates with zero issues.
Isolated loopback app health and a signed missing-assets request proved the
compiled import route accepts the new review policy before stopping prior to
database writes. Public provenance health and the same probe passed after deploy.

The real generator run trun_cf767d809b8c438497a1e9bc9676ea80 then completed:
template open-house-estate-1080 imported with all four assets, library status
quarantined, matching smoke test passed, and run ready_for_review. Every scored
section >=9.8 across comparator and two distinct reviewers; all four reusable
scenarios and the single no-obvious-errors check passed. No activation/publishing.
Rollback image 031bf62a76fe2aa44276296e76a9b2e5703f62a3 remains retained;
protected env backup: /srv/blockwise/backups/template-handoff-20260908-e09a5d6f9/product.env.


## Meta-image CTA revision follow-up

Hermes dc5e088681f4b8ec23d7ffdaf4d599e89dfa16e3 now leaves the image CTA
to Meta, with evaluation policy 10; the canonical Frank guide owns that policy.
The revised sample passed comparator and both final reviewers but exposed a
discard/re-import bug: storage_path contains URL-encoded filename separators,
whereas Storage DELETE prefixes are literal object keys. Rows were removed but
four nested demo objects remained. The duplicate-upload recovery then timed out
reading the existing bytes and surfaced template_artifact_conflict. Direct reads
proved all four existing objects exactly matched the saved artifact bytes.

Blockwise de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd decodes those keys only
for discard; existing upload/download/metadata compatibility stays unchanged.
A new behavioral test verifies decoded prefixes and storage-before-row deletion.
NUL check, typecheck, production Docker build passed. Full tests: 1095 passed,
0 failed, 2 existing skips. The isolated compiled canary imported the real revised
four-asset sample into quarantine, passed Feed/Story smoke, then discarded it.
Read-only inspection confirmed both metadata tables empty and all four objects
absent, proving cleanup rather than just a successful DELETE response.

Before recovery, the exact final artifact including all original asset bytes was
retained at /srv/blockwise/backups/template-cta-recovery-20260908/artifact.json.
Only the four hash-verified orphan demo objects for open-house-estate-1080 were
removed. The approved revised artwork and original run evidence were preserved.
The new app image is blockwise-app:de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd,
image ID sha256:30a1be82028f59131634f641f84fbe8624a3e3381b399e0348812bb4c2c2b08b.
Public product-health verified that compiled revision. Previous e09a5d6f9 image
and /srv/blockwise/backups/template-cta-cleanup-20260908/product.env remain for
rollback. No schema migration, UI changes or provider-write enablement occurred.


## Completed Meta-native CTA revision

Run trun_cf767d809b8c438497a1e9bc9676ea80 completed its directed CTA removal:
no embedded CTA layers or CTA-only editable inputs remain; native Meta CTA
metadata and informational website details are retained. The initial revised
candidate passed its first comparison (iteration 15). Retries retained that
candidate while recovering an upstream HTTP 500 and the storage-cleanup bug;
no further design changes were needed. Events 426/428/430/431 prove final
review accepted, four-asset quarantined import, matching smoke pass and
ready_for_review on Hermes dc5e088681 and Blockwise de606ac66.
Every comparator and both final-reviewer section scores are >=9.85, issues=[],
all effects match/not_present, no_obvious_errors=true and reusable tests 4/4.
The serving first50 quality predicate passes. Batch not started; nothing
activated or published. Temporary canary removed; backups retained.
