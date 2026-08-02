# Blockwise Launch — Agent Execution Plan

**Generated:** 2026-06-10
**For:** A code agent (or a fresh Mavis session) executing the `docs/LAUNCH_PLAN.md` end-to-end.
**Read first:** `AGENTS.md` (non-negotiable rules), `CLAUDE.md`, then `docs/LAUNCH_PLAN.md` (this plan executes it, doesn't replace it).

## What this doc is

`LAUNCH_PLAN.md` is the **what** — 40 tasks across 5 phases, organized by impact, tagged by severity. It's the source of truth for what's needed.

This doc is the **how** — the working protocol, sequencing, and per-task acceptance script an executing agent follows. It also fills three gaps the launch plan deliberately doesn't spell out:

1. **Sequencing** — the launch plan lists tasks; it doesn't say which one unblocks the next. (E.g. you can't do UX-1 until you know the canonical home, which is decided in P0 + Phase 1.)
2. **State handoff** — if you're a fresh session, you don't know what was committed yesterday. This doc tells you how to discover the current state fast.
3. **Don't-break-this** — there's a list of things in the launch plan's "What is already good" section. This doc puts them in the right place (i.e. don't refactor them out of existence while shipping adjacent work).

---

## Working protocol

### Before you touch anything

1. **Read the launch plan end to end** (15 min). Don't skim. The work is ordered, and skipping ahead wastes context.
2. **Read `AGENTS.md`** — auth-behaviour changes, new deps, schema changes, provider-writes are all owner-authorized. If a task says "add a new dep" and the launch plan didn't tag it `[OWNER-AUTHORIZED]`, stop and ask.
3. **Discover current state** (5 min):
   ```bash
   git status
   git log --oneline -10
   git branch --show-current
   npm run typecheck
   npm test
   ```
   Don't proceed if any of these are red. If `typecheck` fails, fix the baseline first.
4. **Read the open PRs / branch diffs** if any. The current branch is `simplification/phase-0-brand-conversion` per the session log.

### While you work

- **One task at a time.** The launch plan is ordered; respect it. If a task isn't done, downstream tasks assume its output.
- **Verify after every task** — `npm run typecheck && npm test` is the floor. For UI tasks, also `npm run build`. For security tasks, also a manual `curl` per the launch plan's acceptance criteria.
- **Commit per task.** Message format: `P0-1: fix truncated .gitignore` (or use the launch-plan ID). One commit = one task = one rollback unit.
- **If a task grows past an hour**, stop. Either split it, or commit what you have and ask the user. Don't ship a 6-hour refactor in one commit.
- **Don't suppress with `any` / `@ts-ignore`** unless the launch plan explicitly says so. If `typecheck` is mad at you, fix the type.
- **Don't print or commit secrets.** Especially the `.secrets/vps_key` from P0-1. The key is the reason P0-1 is the very first task.

### When you get stuck

- The task probably needs splitting. Commit what you have, write a one-line note about the blocker, move on.
- If the blocker is a missing owner-action (env var, Stripe price, Meta app review), that's Phase 5 — not your problem. Document it and continue.
- If the blocker is a real product decision (pricing, scope, behaviour), stop and ask. Don't guess on a decision the user gets to make.

---

## Sequencing — why this order

The launch plan is roughly ordered. Here's the strict dependency map:

```
P0-1 .gitignore       →  P0-2 remove ignoreBuildErrors  →  P0-3 CI build step
                                                       ↓
                                              (typecheck becomes trustworthy)
                                                       ↓
S-1 OPERATOR_EMAILS   ─┐
S-2 health auth       ─┤
S-3 model-profiles    ─┼─→  S-7 CSP  ─→  S-8 rate limits  ─→  S-11 small auth
S-4 ad search SQL     ─┤                                   ↑
S-5 SSRF gaps         ─┤                                   │
S-6 Google Places     ─┤                                   │
S-9 sourceUrl valid.  ─┤                                   │
S-10 provider-runs    ─┘                                  ─┘
                       ↓
A-1 cookie consent    →  A-2 CompleteReg  →  A-3 gtag  →  A-7 landing polish
                       ↓
              A-4 /pricing  (independent of consent; can run in parallel with A-1)
              A-5 Turnstile (env + verify; can run in parallel with A-1)
              A-6 demo notify (owner; can run in parallel with A-1)
                       ↓
UX-1 /start → /self-serve (requires A-2 to know ?confirmed=1 is wired)
UX-2 error/404        (independent)
UX-3 login attrs      (independent, 5 min)
UX-4 settings jargon  (independent)
UX-5 reset pwd        (independent)
UX-6 brand gate nav   (independent)
UX-7 empty states     (independent)
UX-8 small polish     (independent; do last)
                       ↓
O-1 Sentry            →  O-2 orchestration alerts
O-3 team invite       (independent of Sentry)
O-4 rollback doc      (independent; do before O-2 so you have it if O-2 surfaces a fire)
O-5 PWA verify        (independent)
```

Phase 0 has to be done in order. Phase 1 tasks are mostly independent of each other (good parallel work). Phase 2 has A-1 → A-2 → A-3 ordering (consent must exist before pixels fire). Phase 3 is mostly independent. Phase 4 is independent. Phase 5 is the owner.

**Total tasks an agent can do without owner input:** ~32 of 40. The other 8 are env vars, Stripe setup, Meta app review, and pricing — Phase 5.

---

## Per-task protocol (copy this checklist for each task)

For every task in the launch plan, follow this exact order. Don't skip steps.

### Step 1: Read the task in the launch plan

The launch plan's task entry is canonical. Don't rely on this doc's summary — go read the original. Files, problem, fix, acceptance criteria are all there.

### Step 2: Verify the file/line citations

Launch plan cites files and line numbers. The repo has changed since it was written (you're on a different branch than when it was authored). **Always `read` the file first** to confirm the line still references what the plan says. If it's drifted, update the plan in a separate commit before doing the work.

### Step 3: Make the smallest correct change

The launch plan's "Fix" section is usually explicit. Follow it. If you think there's a better approach, **make a note and ask**, don't silently change the plan. The launch plan is the user's strategic intent; deviating without permission is how you ship the wrong thing.

### Step 4: Run the acceptance criteria

The "Accept" section is the test of done. Don't skip it. If the task says "typecheck passes with zero errors," that's not optional because you ran it locally once — that's the new permanent state of the repo.

For security tasks (Phase 1), the acceptance criteria often include a manual `curl`. **Do the curl.** Don't ship a security fix without verifying the attack is actually closed.

### Step 5: Commit with the task ID

```
P0-1: fix truncated .gitignore — restore .secrets/ and Office lock files
```

Or whatever the task ID is. One task = one commit = one rollback unit.

### Step 6: Update the launch plan

Mark the task as done in `LAUNCH_PLAN.md` (e.g. add `✅ DONE 2026-06-10` to the task heading). This keeps the plan useful as a tracking doc.

---

## Discovery cheatsheet

When you start a fresh session, you should be able to answer these in under 10 minutes:

| Question | Command | Expected answer |
|---|---|---|
| What branch are we on? | `git branch --show-current` | `simplification/phase-0-brand-conversion` (or current) |
| What's uncommitted? | `git status` | List of modified + untracked |
| What's the test count? | `npm test 2>&1 \| tail -5` | "tests 453, pass 453" (or current) |
| Is typecheck clean? | `npm run typecheck` | No output (success) |
| What's the build status? | `npm run build 2>&1 \| head -20` | "Compiled successfully" |
| What env vars are required? | `cat .env.example` | The list in `LAUNCH_PLAN.md` Phase 5 |
| What's the launch plan status? | `grep -c "✅ DONE" docs/LAUNCH_PLAN.md` | Count of completed tasks |
| What tasks are still open? | `grep "^- \*\*File:" docs/LAUNCH_PLAN.md` | The remaining work |

If `git status` shows untracked files (especially the refactor from the last session), ask the user whether to commit them before starting new work. Refactor + new feature in one branch = messy history.

---

## The "already good" list — preserve it

From `LAUNCH_PLAN.md` "What is already good":

- Stripe webhook signature verification
- OAuth state HMAC + token vault (`private.provider_token_vault`) + AES-256-GCM token crypto
- RLS with workspace isolation on every workspace table
- Cron watchdog bearer-token gating
- Meta data-deletion HMAC callback
- Redirect sanitization in auth confirm
- Media path-traversal checks
- Operator/workforce layouts gated server-side
- Actionable empty states on leads/results/swipe-file
- Disabled-while-submitting on all forms
- SEO metadata/robots/sitemap
- Substantive legal pages
- Turnstile + honeypot on signup
- Durable VPS `job_queue` suite

**If a task asks you to touch one of these to "fix" something, stop and check.** Either the task is wrong, or you're about to break a working security control. The launch plan was reviewed; if it lists these as "good," trust that.

**Specifically:**

- Don't refactor the OAuth token vault as part of a Sentry integration.
- Don't add new deps to the Stripe webhook handler. Read it, leave it alone unless a task explicitly targets it.
- Don't change the RLS policies in a migration unless the task is about RLS. RLS changes are easy to break silently.
- Don't touch `redirect sanitization in auth confirm` — UX-1 has a separate redirect fix (S-11) that goes alongside, not through, the existing sanitization.

---

## Recurring mistakes to avoid

These are the patterns that bit past refactors. Pre-commit, scan your diff for them.

### 1. Don't add a dependency without checking `.npmrc` and `package.json`

There's `.npmrc` for legacy-peer-deps (commit `14f2053` exists for this). If a task wants a new dep and the build complains, the right fix is `.npmrc` + `--legacy-peer-deps`, not skipping the task.

### 2. Don't import from a sibling package using deep paths

`@/lib/...` is fine. `../../../lib/...` is fragile. If you find yourself writing the latter, add an alias or fix the import map.

### 3. Don't add new env vars without updating `.env.example` AND `scripts/verify-env.mjs`

A new env var that isn't in `.env.example` will fail `verify-env` for new deployers. The launch plan's O-1 / A-3 / A-5 tasks all add vars; each one must update both files.

### 4. Don't write "TODO" comments in production code

The launch plan's P0-2 says "if used [any/ts-ignore], leave a `// TODO` comment" — this is an exception, not permission. Real TODOs go in `docs/` or in the launch plan itself. Code is either done or it's a follow-up task.

### 5. Don't ship a security fix without the manual test

Phase 1 acceptance criteria almost always include a `curl` or browser action. If you don't run it, you don't know the fix works. A typecheck-clean security task is a green light to deploy the bug, not a green light to ship the fix.

### 6. Don't use the PowerShell `npm` directly

PowerShell blocks `.ps1` script execution by default on this machine. Use `cmd /c "npm ..."` for any npm script. Direct `npm` calls will fail with `UnauthorizedAccess`.

### 7. Don't `rm -rf` — use `mavis-trash`

Recoverable deletion. The mavis-trash tool moves to OS trash; `rm` is irreversible.

---

## Time budget per task (rough)

Based on past refactor velocity and the launch plan's complexity:

| Task class | Typical time | Notes |
|---|---|---|
| `.gitignore` / `package.json` / `.env.example` fixes | 5–15 min | Trivial; just commit. |
| Auth guard on an endpoint (S-3, S-6) | 20–40 min | Copy an existing guard, adapt it. |
| SSRF / SQL filter fix (S-4, S-5) | 30–60 min | Add unit tests for the bypass cases. |
| Rate limit (S-8) | 1.5–3 hours | Build the helper, wire 4–5 endpoints, write tests. |
| Cookie consent banner (A-1) | 1.5–2.5 hours | Component + storage + pixel gating. |
| Pricing page (A-4) | 1–2 hours | Mostly copy + nav wiring. |
| User flow fix (UX-1 through UX-6) | 30–90 min each | Mostly finding the right place to redirect. |
| Empty states batch (UX-7) | 1.5–2.5 hours | Cross-component touch. |
| Sentry wiring (O-1) | 1–2 hours | Wizard + verification error fires. |
| Verification gate at the end | 30 min | Run all the things, write the report. |

**Total agent-only work:** roughly 4–6 days of focused execution for one person. Realistically, with context switching, this is a 1–2 week sprint.

**Total with owner-actions in parallel:** the same — the 8 owner tasks are mostly "wait for Stripe / Meta to respond" which is async.

---

## Verification gate — what to run before declaring done

This is the "are we actually ready to ship" check. Run it from the repo root.

```bash
# 1. All static checks green
npm run check       # NUL check + tests + typecheck
npm run build       # production build green

# 2. Fresh-user e2e on production
#   Manual: signup → Turnstile renders → confirm email → land on /self-serve →
#   onboarding wizard → Ad Studio sample campaign → Settings (no jargon)
#   This is a human script. Don't skip the human.

# 3. Security spot-checks
curl https://blockwise.sale/api/health
#   Expected: {"app":"blockwise","status":"ready"} only
curl https://blockwise.sale/api/model-profiles
#   Expected: 401/403
curl "https://blockwise.sale/api/research/ads/search?q=foo,status.eq.active"
#   Expected: no PostgREST parse error
git check-ignore .secrets/vps_key
#   Expected: 0 (file is ignored)

# 4. Pixel checks (Meta Pixel Helper browser extension)
#   - No pixel before consent
#   - PageView after consent
#   - CompleteRegistration on signup
#   - Lead on demo form (when set up)

# 5. /pricing live
curl -s https://blockwise.sale/pricing | grep -c "Pricing"
#   Expected: > 0
# Footer legal links work
curl -s -o /dev/null -w "%{http_code}" https://blockwise.sale/privacy
#   Expected: 200
curl -s -o /dev/null -w "%{http_code}" https://blockwise.sale/terms
#   Expected: 200

# 6. Force one error → appears in Sentry
#   Throw an Error in an API route, deploy, hit the route, check Sentry UI.
#   Owner action.

# 7. Playwright suite
npm run test:e2e

# 8. Update the launch plan
#   Mark every task ✅ DONE with date. The plan is now the post-launch changelog.
```

If any of these fail, **don't ship**. The whole point of the gate is to catch it before a real user does.

---

## When to stop and ask the user

| Situation | Action |
|---|---|
| Task says "TODO placeholder" (e.g. pricing) | Ask. Don't pick a number. |
| Task says `[OWNER-AUTHORIZED]` and the user hasn't said yes to that specific change | Ask. |
| You find a new bug while doing another task | Note it. Finish the current task. Add it as a new task in `LAUNCH_PLAN.md` for the next session. Don't expand scope. |
| You disagree with a task in the plan | Write a one-paragraph note, commit nothing, ask. |
| Build is red after a task you didn't break | `git stash` your work, `git log` to see the last green commit, ask. |
| You realize a task depends on a Phase 5 owner-action | Document the dependency. Move on. |
| You finish a phase and the verification gate has gaps | Don't proceed. List the gaps. Ask. |

---

## One-page summary for the user (paste this in your handoff)

> Blockwise launch is a 5-phase plan with ~32 agent-executable tasks and ~8 owner-action tasks. Total agent work: ~1–2 weeks. Owner work is mostly waiting on Stripe / Meta.
>
> Phase 0 (3 tasks, ~30 min) is emergency — unblock gitignored secrets, turn on typecheck in CI. Do this first.
>
> Phase 1 (11 tasks, ~3 days) is security — auth gaps, SSRF, rate limits, CSP. Mostly independent; good for parallel work.
>
> Phase 2 (7 tasks, ~2 days) is conversion — cookie consent, pixels, pricing, Turnstile.
>
> Phase 3 (8 tasks, ~2 days) is UX — dead routes, jargon in settings, empty states, login form.
>
> Phase 4 (5 tasks, ~1 day) is ops — Sentry, queue-worker alerts, team invite, rollback runbook.
>
> Phase 5 is owner-only — Stripe setup, Meta app review, env vars, pricing decision.
>
> Before flipping ads on: run the 8-step verification gate in `docs/LAUNCH_PLAN.md`. If any step fails, don't ship.

---

## Appendix: what changed during the last session (2026-06-10 morning)

If the branch is still `simplification/phase-0-brand-conversion` and the refactor isn't committed, here's what to do with it:

1. **Ad Studio refactor** (uncommitted, ~7 new files): commit it as `refactor(adstudio): extract 5 hooks, panel registry, unified pack-mutation`. The work is reviewed and tests are green (453/453).
2. **`react-is` dep** (uncommitted): should be committed in the same refactor commit, or separately as `chore(deps): add react-is for recharts peer dep`. Pick one.
3. **The 2 `matrix-media-*.png` files in repo root**: not yours to commit. Either `.gitignore` `matrix-media-*.png` or move them to `docs/screenshots/` if you want to keep them.

These are sitting as untracked. Don't build on top of them without committing first — `git status` will get noisy fast.
