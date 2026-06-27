# blockwise-agent-cleanup

## Purpose

Run the final cleanup gate before any Blockwise agent reports a task as done,
hands work off, opens a PR, or exits a session. Clean only artifacts the current
agent created or can prove are disposable. Preserve user work, unknown local
changes, source data, secrets, databases, and deliverables the user asked for.

## Completion contract

An agent must not say a job is done until its own mess is resolved. Resolved
means one of:

- the agent-created change is committed, pushed, and tied to a PR or merged
- the agent-created local artifact is deleted
- the artifact is an intentional deliverable named in the final report
- the artifact is blocked by missing access or a required human decision named
  in the final report

Pre-existing dirty files do not block completion only when the agent proves they
pre-date its work and lists them as retained external dirt. Do not blur this:
agent-owned dirt must be cleaned, committed, or explicitly blocked.

## Workflow

1. Inventory the workspace before cleanup:
   - Run `git status --short --branch`.
   - Run `git diff --name-only` and `git ls-files --others --exclude-standard`.
   - Check for generated scratch files, temp folders, logs, caches, screenshots,
     local servers, background jobs, stale branches, worktrees, open PRs, and
     pending CI.
   - Separate agent-owned artifacts from unrelated user or teammate work.

2. Clean the agent-owned mess:
   - Remove or move only disposable files the agent created for exploration,
     failed attempts, local verification, or throwaway outputs.
   - Stop local dev servers, watchers, background helpers, and tunnels started
     for the task.
   - Delete empty temp directories and generated caches when they are not part
     of the requested deliverable.
   - Stage and commit intended repo changes, then push/open/update the PR when
     the task scope calls for source changes.
   - If the current branch tracks a deleted upstream or is based on stale main,
     do not pile new work onto it. Move the intended change to a fresh branch
     from `origin/main` or clearly report why that is blocked.
   - Prune remote-tracking refs after fetches when safe.
   - Label or comment unresolved PRs/issues instead of hiding ambiguous work.

3. Verify the end state:
   - Re-run `git status --short --branch`.
   - Confirm that every remaining dirty path is either pre-existing, an
     intentional deliverable, or an explicitly blocked item.
   - Confirm required tests, builds, CI, deployments, or runtime checks have
     finished, or document exactly why they remain blocked.
   - Confirm no secrets, `.env*` files except `.env.example`, databases,
     `node_modules/`, build output, or local agent state were staged.

4. Report honestly:
   - List cleanup actions performed.
   - List committed branch/PR/merge status when source changes were made.
   - List intentionally retained artifacts and why they remain.
   - List any blocker with the single command or approval needed from Steven.

## Output

Concise completion note with:

- cleanup performed
- verification run and result
- retained mess, if any
- blocked items, if any

## Constraints

- Never use cleanup to undo user work or erase unknown changes.
- Never run destructive broad cleanup such as `git clean`, `git reset --hard`,
  force-push, or history rewrite unless Steven explicitly requests it in the
  current session.
- Do not delete databases, secrets, `.env*` files, production exports, archived
  research payloads, or evidence artifacts.
- Do not declare the task complete while a required command, CI run, deploy,
  local server, or background job is still running.
- Do not leave agent-created source changes merely unstaged in the dirty
  worktree. Commit/push/PR them, delete them, or mark the exact blocker.
- If cleanup is unsafe because ownership is ambiguous, quarantine by reporting
  the artifact and reason instead of deleting it.

## Tools

- `git status --short --branch`
- `git diff --name-only`
- `git ls-files --others --exclude-standard`
- `git fetch --all --prune`
- `gh pr list`
- `gh run list`
- `git worktree list --porcelain`
- `Get-Process`
