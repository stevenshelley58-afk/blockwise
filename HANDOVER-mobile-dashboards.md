# Handover — mobile dashboards (Blockwise)

**Date:** 2026-07-28 · **Repo:** `stevenshelley58-afk/blockwise` · **Spec:** `docs/plans/2026-07-28-mobile-dashboards-spec.md`

**Production right now: `385a57c`, healthy, 8 of 9 tasks live.**

---

## 1. The one thing left to do

**Task 8 (two-up Ad Studio template gallery) is written, verified, and NOT pushed.**

It is a single commit in `task8-template-gallery.patch`, in the repo root on the owner's machine (`C:\Dev\Blockwise\`).

```bash
git checkout -b feat/template-gallery-mobile 385a57c
git am task8-template-gallery.patch      # no --keep-cr needed for THIS patch
git push -u origin HEAD
```

Then open a PR against `main`, confirm CI, merge. Prod deploys automatically from `main`.

Verification facts, so you can prove the patch is intact before trusting it:

| | |
|---|---|
| parent commit | `385a57c` (exactly what is in prod) |
| resulting tree hash | `41b32490ad14c5526f9dbe4de0092b23dd546822` |
| patch sha256 (first 16) | `18c07176e9334d4b` |
| files touched | `src/components/adstudio/new-ad-dialog.tsx` only |

`git rev-parse HEAD^{tree}` after `git am` must print `41b3249…`. If it does, the change is byte-identical to what was tested. If it doesn't, stop.

**Already verified against that exact tree** — do not redo unless you change something:
`npm run check` 943/943 · `npm run verify:hard-reset` 29/29 · `tsc --noEmit` clean · `next build` compiles.
Layout measured at 360/390/430px: 2 columns, cards inside the viewport, footer action bar hidden, previews normalised to 4:5. Unchanged at 900px (2-up) and 1440px (3-up).

### Why it wasn't pushed

This sandbox has **no git write access**. The proxy authenticates `api.github.com` but not `github.com` git operations — `git push` fails with "Invalid username or token" no matter how credentials are supplied. `GH_TOKEN` is the literal string `proxy-injected`.

The only write channel is the GitHub MCP (`push_files` / `create_or_update_file`), which **replaces whole files** — it cannot patch. `new-ad-dialog.tsx` is 1,988 lines / 95KB, so landing Task 8 that way means retyping the entire ad-creation dialog by hand. I got ~820 lines in and stopped: the remaining read plus a 95KB emission wasn't going to fit, and a truncated file pushed to the core ad-creation flow is a bad trade. Sixteen other files went through that path successfully and were each verified byte-for-byte, so the method works — this file is just too big for it.

**If you also have no git push:** don't attempt the retype. Ask the owner to run the three commands above; it takes 30 seconds.

---

## 2. What is live in prod (`385a57c`)

| Task | Status |
|---|---|
| 1 — mobile width / table overflow | ✅ live, **fixed properly in #281** (see §3) |
| 2 — Leads tiles two-up, "Duplicates" | ✅ live |
| 3 — empty search field + `sr-only` scope line | ✅ live |
| 4 — two-row Ad Radar controls | ✅ live |
| 5 — Brand Pack suburb auto-load | ✅ live |
| 6 — two-up ad tiles + fullscreen `CreativeViewer` | ✅ live |
| 7 — Results in the mobile tab bar | ✅ live |
| **8 — two-up template gallery** | ❌ **not live** — §1 |
| 9 — Performance mobile density | ✅ live |

PRs: **#278** (tasks 1–7, 9), **#281** (the real Task 1 fix). Tracking issue: **#280**.

---

## 3. Task 1 — read this before touching mobile layout

The original Task 1 fix **did not work**, and it passed every gate we had. This is the most important lesson in this handover.

The spec (§2.3) required measuring the `/results` overflow at 390px *before* applying a fix. That measurement was skipped twice. When it was finally taken, the before/after numbers were identical:

| | panel width | table container | `scrollLeft` max | CPL column reachable |
|---|---|---|---|---|
| before Task 1 | 862px | 820 visible / 820 total | 0 | ❌ |
| after Task 1 (shipped!) | 862px | 820 visible / 820 total | 0 | ❌ |
| after #281 | 358px | 316 visible / **820 total** | 504 | ✅ |

`min-w-0` + `overflow-x-clip` on `SidebarInset` changed nothing. The blowout was one level lower: panels are grid items with `min-width: auto`, so the implicit track sized to the 820px campaigns table's max-content. The panel stretched to 862px, its own `overflow-x-auto` wrapper was equally wide and therefore never became a scroll container, and `overflow-x-clip` suppressed the page scrollbar that would have made it obvious. Net effect: Spend / Impressions / Leads / CPL were **unreachable** on a phone.

Fix (#281) is one line in `src/components/ui/table.tsx`:

```
className="relative w-full overflow-x-auto [contain:inline-size]"
```

`contain: inline-size` decouples the container's inline size from its contents so the min-content contribution stops propagating. Fixed in the primitive, so it covers all three wide tables — campaigns (820px), suburb breakdown (680px), creative versions (720px) — and any added later. Desktop measurements at 1440px are byte-identical to before; no regression.

**Takeaway for you: build-green ≠ correct for layout work. Measure it.**

---

## 4. The measurement harness (worth keeping)

Playwright + the app's *real compiled CSS* + the real DOM nesting, measured at 360/390/430/1440px. It is what caught the Task 1 bug. Rebuild it like this:

```bash
git clone https://github.com/stevenshelley58-afk/blockwise.git && cd blockwise
npm install --no-audit --no-fund
npm run build
cat .next/static/chunks/*.css > /tmp/app.css     # the real compiled Tailwind
# harness page: link /tmp/app.css, reproduce the exact class strings + nesting
# from the components under test, then measure with Playwright
```

Notes that cost me time:
- Playwright is installed globally at `~/.npm-global/lib/node_modules`; symlink it into the harness dir or the import fails. Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Do **not** run `playwright install`.
- Use `page.goto('file://…')`, **not** `setContent()` — with `setContent` the `file://` stylesheet doesn't load and every measurement silently comes back wrong.
- A utility only exists in the compiled CSS if the app already uses it somewhere. My first attempt at a fix measured as a no-op purely because `grid-cols-[minmax(0,1fr)]` wasn't in the bundle yet.
- Measure the **actual scroll container**. The Ad Radar / results tables nest `overflow-x-auto` twice; measuring the outer wrapper gives a misleading "no overflow" reading.

**Recommendation:** promote this into a real test in the repo so no future agent can claim a mobile layout fix without a measurement. That is the single highest-value follow-up here.

---

## 5. Still outstanding

**a) Nobody has looked at any of this on a real phone.** Everything is build-green and harness-measured; none of it is photographed on a device. Specifically unverified:

- 4:5 tile cropping on real Meta creative (does the crop lose the subject?)
- `CreativeViewer` on real iOS Safari and Chrome Android: swipe paging, swipe-down dismiss, Android hardware back, muted-autoplay video and tap-to-unmute
- Six-tab bottom nav at 360px — 9.5px labels are at the truncation limit
- Performance KPI row with real four-figure spend values at 21px
- Task 5: that a real Brand Pack `contact.address` parses to the right suburb. Unit tests cover the parser, not the shape of addresses actually in `adstudio_brand_kits.contact_json`.

**b) `verify-env` was dropped from the Vercel build command — decide this deliberately.** `e3fc724` removed both `npm run check` and `npm run verify-env` from `buildCommand`; the commit message only justified removing `check`. I restored `verify-env`, then #279 landed independently and resolved it the other way, so I deferred to main. Current state: a deploy with missing or placeholder env **builds and ships** rather than failing at build time. CI cannot cover this — it checks the repo, not the deploy target's environment.

---

## 6. Environment traps

- **No git push.** See §1. The GitHub MCP is the only write path, and it replaces whole files.
- **The MCP push normalises CRLF to LF.** `tests/env.test.ts` and `vercel.json` are CRLF in this repo. Pushing them via the API rewrites the whole file and **causes merge conflicts against `main`**. This bit me once. You *can* emit CRLF by writing `\r\n` escapes in the JSON tool argument — that is how the conflict was eventually cleared.
- **Multi-commit patches need `git am --keep-cr`** if they touch those CRLF files, or the CR is stripped as trailing whitespace and the patch won't apply. The Task 8 patch in §1 does *not* touch them, so plain `git am` is fine there.
- **API pushes may not trigger GitHub Actions.** The workflow runs didn't fire on the MCP-pushed commits; only Vercel's checks did. Verify locally before merging — don't assume a green PR page means CI ran.
- **The owner's local clone was stale** (main at `91fc29d`) with **391 modified files** on `main`. Do not check out or stash in their working tree; use a worktree or a fresh clone.
- **Other agents are active in this repo.** #279 landed mid-session and conflicted with my work. Re-fetch `main` before assuming anything about its state.

---

## 7. Process note

The session started as a review of PR #278, which claimed nine completed tasks and four new files. The branch actually contained **three commits and five one-line changes**; the four "new files" had never been committed. Task 1 was additionally reported as fixed when it was not.

Both failures share a root cause: work was reported as done because it compiled and the suite was green. If you pick this up, the useful habit is to check the diff against the claim, and to measure anything visual rather than reasoning about it from source.
