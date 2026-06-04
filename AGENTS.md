# Blockwise Engineering Rules

## Primary Goal

Reduce *user-facing* complexity and code complexity. The product should hide
implementation detail from customers and make the first-run experience linear.
Simplifying the UX is now in scope and may add code where it removes user
confusion. Behaviour-safety rules below (auth, schema, API shapes, provider
behaviour) still hold.

## Two Modes of Work

1. **Refactor PRs** — pure internal cleanup. These must still reduce net
   production LOC and preserve behaviour (see Refactor Rules below).
2. **Simplification PRs** — deliberate UX redesign to hide complexity (e.g.
   onboarding wizard, renaming jargon, consolidating surfaces). These MAY
   increase LOC and MAY change UI, as long as they reduce the number of
   decisions and concepts a *user* must face. Tag the PR `simplification` and
   state which user-facing complexity it removes.

## CodeGraph Freshness

- At the start of code work, check CodeGraph freshness with MCP `codegraph_status` or `codegraph status`.
- If no index exists, run `codegraph init -i`.
- If the index is stale or pending, run `codegraph sync` or trust the MCP watcher after edits.
- If CodeGraph reports a stale-file banner, read that file directly before editing.

## Deployment and Testing

- Do not run local deployments.
- Test deployed behavior only through Vercel Preview or Production URLs.
- Do not use localhost smoke tests as acceptance for deployment readiness.

## Service Access and Tooling

- Use the official CLI, MCP server, or installed plugin for GitHub, Vercel, Supabase, and other hosted services whenever available.
- If a required GitHub, Vercel, or Supabase action needs authentication, start the normal login flow and wait for the user to approve the OAuth prompt.
- Do not avoid hosted-service work because authentication is missing; request/login through the approved tool path instead.
- Prefer MCPs and plugins over browser scraping, and prefer CLIs over ad hoc API calls when the CLI supports the task.

## Hard Rules

These always hold, in both modes:

- Do not add new dependencies.
- Do not create generic helpers, managers, engines, processors, registries, or factories unless they replace clear duplicated code.
- Do not create interfaces unless there are at least two real implementations now.
- Do not future-proof.
- Do not change database schema.
- Do not change public API response shapes.
- Do not change auth behaviour.
- Do not change provider behaviour.

## Refactor-PR Rules (mode 1 only)

- Net production code lines must decrease.
- Deleting code is preferred over moving code.
- Collapsing duplicate code is preferred over adding abstractions.
- Do not redesign UI.

## Simplification-PR Rules (mode 2 only)

- UI redesign is allowed when it removes user-facing complexity.
- Prefer progressive disclosure: hide advanced controls behind "Advanced".
- Prefer plain language over internal/jargon terms in customer surfaces.
- LOC may increase, but justify the trade against user confusion removed.

## Code Reduction Targets

For each PR, report:

- production lines before
- production lines after
- net production LOC change
- files deleted
- files created
- largest file before
- largest file after
- duplicated code removed
- behaviour changed: yes/no

A refactor PR is not acceptable unless production LOC decreases, excluding
tests. Simplification PRs are exempt from the LOC-decrease requirement.

## Preferred Refactor Order

1. Delete unused code.
2. Delete duplicate demo/sample logic.
3. Collapse duplicated helpers.
4. Simplify oversized files.
5. Move code only when it clearly reduces coupling.
6. Add tests only where needed to protect behaviour.

## Forbidden Pattern

Do not replace one messy file with five new messy files.

## Acceptance

A refactor PR is successful only if:

- behaviour is preserved
- typecheck passes
- relevant tests pass
- production LOC decreases
- the number of concepts a developer must understand decreases

A simplification PR is successful only if:

- typecheck passes
- relevant tests pass
- auth, schema, API shapes, and provider behaviour are unchanged
- the number of decisions/concepts a *user* must face decreases
