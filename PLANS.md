# PLANS.md

Generated from the rules review on 2026-09-11. 19 rules, consolidated from 28 source documents.

## How to use this file

- **Purpose.** This is the single index of open work for Blockwise and Frank. One entry per workstream, with its current state, the evidence that proves the last step, and what remains. It replaces scattered dated plan documents as the place an agent looks first.
- **One writer per entry.** One writer per entry. An agent working an entry updates its state and evidence in the same change that lands the work. Never open a second entry for work already listed.
- **Dated records are history.** A dated record in docs/releases/, docs/evidence/ or docs/plans/ is history and evidence. It is not an instruction and not a claim about current production. Only this file states what is currently open.
- **Do not infer done.** Never record a plan as done from a written intention, a passing unit test, or a merged PR alone. Record the revision and the check that observed the behaviour.

## Open work

- **Rules reconciliation.** Consolidate every rule file on this VPS into one AGENTS.md, one PLANS.md, one DESIGN.md and one skill root. Adopt the approved text from the review page, replace the stale copies, and delete the retired ones.
- **Skills single root.** Move skills to a single canonical root, keep every runtime pointed at it, and require frontmatter on every SKILL.md. Delete duplicate trees rather than syncing them.
- **Docs index repair.** docs/README.md is named as the sole procedure index. Confirm it exists in the canonical checkout, indexes every current guide, and lists no retired procedure as current.
- **Provider gates.** Record the exact state of each provider gate: which are open, which are closed, and the evidence that opened the last one. Keep provider writes disabled until the gate passes.
- **Production revision.** State the live revision currently serving production and the check that observed it. An old release record is not a current claim.

## Decisions already made

- **Deployment path.** Releases go through scripts/vps/product-release.sh into an immutable checkout. Rollback uses a retained verified release. Decided; do not reopen without new evidence.
- **Vercel and managed Supabase are retired.** Retired for this product. Production is the self-hosted VPS Compose stack: Next standalone, PostgreSQL, PostgREST, GoTrue, Storage API, Caddy, and a separately gated worker. Supabase client packages are protocol clients, not a managed runtime.
- **Model routing.** Use DeepSeek models through Concentrate, not a direct DeepSeek account. Keep the direct provider disabled with no credential in the active stores. Changing chat routing does not change frozen Ad Template Generator routes or approval gates.
- **Skills runtime.** The shared skills library is central and runs only through Hermes. Approved references are a separate scoped boundary and never merge private memory or create a second agent loop.
- **Template generation policy.** One cross-system policy at /projects/frank/docs/AD_TEMPLATE_GENERATOR.md owns operator workflow and acceptance. Blockwise consumes it and keeps no copy.

## Risks and known gaps

- **Rules drift.** Rule files on this VPS drift because copies are edited where they sit. The guard is the single-source rule in AGENTS.md plus deleting the copies, not periodic re-syncing.
- **Unenforced invariants.** A rule with no mechanism is advice. For each constitution rule, either name the check that enforces it or record it here as manually reviewed.
- **Stale references.** Files referenced by the rules that no longer exist break agent trust in the whole file. Verify references when editing any rule file.

## History

- **Where evidence lives.** docs/releases/ holds dated release records. docs/evidence/ holds proof artifacts. docs/plans/ holds proposals. All three are read-only history for an agent unless the task is to update them.
- **Retention.** Keep the live release and the documented rollback releases, with their exact retained paths. Remove task scratch that is not evidence. Follow the owning infrastructure retention policy rather than adding a competing cleanup schedule.


---

## Changelog

- 2026-09-11: created. Replaces scattered dated plan documents as the single
  index of open work, with the decisions already made and the known gaps.
