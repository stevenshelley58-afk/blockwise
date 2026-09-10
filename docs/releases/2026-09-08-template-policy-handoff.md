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

## Gate change note, 10 September 2026

The pass gate moved from 9.8 to 9.5: the review policy literal is now
`section-95-font-exempt-no-obvious-errors-v1` with 9.5 section/reviewer
minimums. The contract keeps accepting frozen `section-98-...` artifacts and
legacy 9.5+ likeness thresholds on read; new artifacts must declare the
section-95 policy. The history above still describes the 9.8 era accurately.
