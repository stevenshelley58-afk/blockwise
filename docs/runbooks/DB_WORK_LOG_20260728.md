# Blockwise — Database Work Log, 2026-07-28

Executed live against Supabase project `blockwise` (uwwbvdloschaccycjozr, ap-southeast-2) via MCP.
Every item below is verified, not proposed.

---

## 0. Review of the previous agent's reported work

**None of the claimed code changes exist.** Verified against the working tree, all local and remote
branches, all 11 worktrees, `git stash list` (empty), and the reflog.

| Claimed | Actual |
|---|---|
| `staleTimes: { dynamic: 30 }` | absent — `next.config.ts:14` is still `optimizePackageImports: ["recharts"]` |
| `optimizePackageImports: ["radix-ui"]` | absent |
| `(operator)/loading.tsx` | file does not exist |
| Poll backoff 2.5s→10s | `TEMPLATE_JOB_POLL_INTERVAL_MS = 1_000` unchanged (`use-campaign-actions.ts:24`) |
| `useVisibleInterval` hook | 0 matches in `src/` |
| `<SpeedInsights />` | 0 matches |
| `/qa-status` endpoint | directory does not exist |
| `verify-jwt.ts` (local JWT) | file does not exist |
| Meta Pixel scoped to marketing | still global at `layout.tsx:110` |
| Waterfall / cache-header fixes | not present |

Nothing was broken — the work simply never landed. The code half of the plan is still entirely open.

---

## 1. THE headline fix — one missing index

`research.work_queue` had only `work_queue_dedupe_idx ON (queue_name, dedupe_key)`. Hermes queries
`WHERE dedupe_key = $1` **without `queue_name`**. Because `queue_name` is the leading column, Postgres
could not seek — it scanned the entire 88 MB index on every call.

Measured on production before the fix:

```
Index Scan using work_queue_dedupe_idx  (actual time=2569.421..2569.422 rows=0)
  Buffers: shared hit=4939 read=6020        -- 10,959 buffers
Execution Time: 2569.478 ms
```

That query shape ran **16.2 million times in 33 days** and was the #1, #2 and #3 most expensive
statements in the database — ~57 hours of DB CPU.

**Applied:**
```sql
CREATE INDEX CONCURRENTLY work_queue_dedupe_key_only_idx
  ON research.work_queue (dedupe_key) WHERE dedupe_key IS NOT NULL;
```

After (same query, cold):
```
Index Scan using work_queue_dedupe_key_only_idx  (actual time=0.041..0.041)
  Buffers: shared hit=4
Execution Time: 0.090 ms
```

**2,569 ms → 0.090 ms. 10,959 buffers → 4.** Re-verified with a real key post-ANALYZE: 6 buffers.

This is the single change that mattered most. It is why the "move research off Supabase" emergency
is no longer an emergency (see §7).

---

## 2. Other missing indexes on hot queries

| Index created | Fixes | Was costing |
|---|---|---|
| `ad_fetch_runs (source_provider, started_at)` | daily-spend guard, `WHERE source_provider=$1 AND started_at BETWEEN` | 341 ms × 109,466 calls ≈ **10.4 h** |
| `work_queue (status, updated_at)` | `WHERE status=$1 AND updated_at<$2 ORDER BY updated_at` | 219 ms × 21,256 calls ≈ **1.3 h** |
| `agent_decisions (created_at)` | retention scans | full 3.6 GB scan per pass |
| `ingest_events (created_at)` | retention scans | full scan per pass |

---

## 3. Index hygiene

- **137 duplicate index groups dropped** (70 `public`, 39 `legacy_archive`, 27 `research`, 1 `private`).
  Kept exactly one per identical group; never touched primary keys or constraint-backed indexes;
  where two copies existed, kept the one with more scans. **Remaining duplicates: 0.**
  ~158 MB reclaimed in the write-heavy `research` schema, and every INSERT/UPDATE on those tables
  now maintains one index instead of two.
- **42 missing foreign-key indexes created** (37 `public`, 5 `research`). **Remaining unindexed FKs: 0.**

---

## 4. Retention — what was and was NOT deleted

### Your ads were never touched. Verified before and after:

| Table | Rows before | Rows after |
|---|---|---|
| `observed_ads` | 5,146 | **5,146** |
| `media_assets` | 24,400 | **24,400** |
| `ad_creatives` | 1,603 | **1,603** |
| `ad_snapshots`, `ad_creative_versions`, `advertiser_pages` | unchanged | unchanged |

### What was purged (30-day window, write-only logs only)

| Table | Before | After | Removed |
|---|---|---|---|
| `ingest_events` | 3,492,840 | 2,264,144 | **1,228,696** |
| `agent_decisions` | 928,714 | 729,049 | **199,665** |

`ingest_events` is a job-lifecycle log — event types are `claim` (1.16 M), `insert` (1.06 M),
`complete` (1.03 M), `fail`, `block`. Nothing in the database references it. Read 187 times in 33 days.

`agent_decisions` is the classifier's working-out. **9 tables have foreign keys into it**, so the
purge explicitly skips any row still referenced by `advertiser_pages`, `ad_creatives`,
`ad_quality_scores`, `coverage_audits`, `coverage_defects`, `ad_style_profiles`,
the then-current research derivation tables, `ingest_events`, or a superseding decision.

### What was deliberately NOT done: `work_queue`

The plan called for purging completed `work_queue` rows (1.03 M of them). **Rejected.** The dedupe
check queries `dedupe_key` across *all* statuses — deleting completed rows makes Hermes forget it
already did that work and re-queue it, re-scraping and re-paying providers. With the index from §1,
a 1 M-row queue costs nothing to look up, so there is no benefit to trade against that risk.

---

## 5. Ongoing retention (pg_cron)

`pg_cron` installed. One job:

```
jobid 4 | research-log-retention | 15 18 * * *  (02:15 Perth) | active
  -> select research.purge_research_logs(30, 25000, 8)
```

`research.purge_research_logs(p_days, p_batch, p_max_batches)` is `SECURITY DEFINER`,
`SET statement_timeout = 0`, batched, and capped at 8 × 25,000 rows per table per run (~200 K/night
against a ~93 K/night inflow — keeps up and slowly eats the remaining backlog without a WAL spike).

Change the window later with one statement:
```sql
select cron.unschedule('research-log-retention');
select cron.schedule('research-log-retention','15 18 * * *',
  $$select research.purge_research_logs(14, 25000, 8)$$);
```

Run it manually any time: `select research.purge_research_logs(30);`

---

## 6. Incident: ~2-minute read-only window (self-resolved)

**What happened.** Bulk deletes generated WAL faster than checkpoints recycled it. WAL reached
2,368 MB on top of a 9.1 GB database; disk crossed Supabase's 95 % threshold and the project entered
read-only mode (`default_transaction_read_only = on`) at ~03:38 UTC. Writes would have failed during
that window.

**Recovery.** Auto-scaling expanded the disk and read-only cleared on its own by ~03:40 UTC. I
confirmed with a real write probe (`CREATE TABLE` + `INSERT` + `DROP`) — succeeded. I unscheduled the
aggressive every-2-minute backlog job that was compounding it, and retuned the nightly job to
gentler batches so it cannot recur.

**Current state:** `default_transaction_read_only = off`, writes verified working, autovacuum has
already reclaimed the deleted space (`n_dead_tup = 0` on both purged tables).

**Action for you:** check **Database Settings → Disk size** in the dashboard. Auto-scaling adds 50 %
each time and is capped at 4 resizes per rolling 24 h; if you're near the ceiling, bump it manually.
Disk over 8 GB bills at $0.125/GB/month.

**Note on DB size:** it still reads ~9.2 GB. Deleting rows doesn't shrink the file — it frees space
*inside* it for reuse. ~2 GB is now free internally, so the disk should stop growing. Only a
`VACUUM FULL`/`pg_repack` (both need a maintenance window and a table lock) or a project upgrade
physically shrinks it.

---

## 7. On moving research to the VPS

**I could not reach the VPS from this session.** SSH port 22 on `76.13.209.160` is not reachable from
the Anthropic sandbox, and `device_bash` (your machine) has no network access. So nothing was
deployed there. That work needs a terminal on your side.

**More importantly: the case for moving it has largely evaporated.** The reason research was
crushing your customer database was not that it shared the box — it was one query doing a full
88 MB index scan 16.2 million times. That's fixed. The same workload now costs roughly 1/1000th of
the DB time it did this morning.

Recommended order now:

1. **Let it run for a week and measure.** `pg_stat_statements` was snapshotted to
   `ops.pgss_snapshot_20260728` (top 100 statements, pre-fix) and then reset. Compare in ~7 days:
   ```sql
   select calls, round(mean_exec_time::numeric,2) mean_ms,
          round((total_exec_time/1000/3600)::numeric,2) hours,
          left(regexp_replace(query,'\s+',' ','g'),120) q
   from extensions.pg_stat_statements order by total_exec_time desc limit 20;
   ```
   If research no longer appears near the top, **do not do the migration** — it's weeks of work and a
   second compute bill for a problem you no longer have.

2. **Cheap win that doesn't need a migration** — cut Hermes's poll rate at the source. Compose sets
   `HERMES_QUEUE_LOOP_INTERVAL_MS=10000`; 30–60 s costs nothing in freshness now that the queue is
   nearly idle (28 open jobs vs 1.03 M complete). One env change + `docker compose up -d`.

3. **Only if step 1 still shows pressure**, split `research` into its own Supabase project — not the
   VPS. Your `.env.example` already has distinct `HERMES_SUPABASE_URL` / `HERMES_SUPABASE_SECRET_KEY`
   names, and `docs/runbooks/paid-service-alerts.md:106` already refers to "main + Hermes projects",
   so the seam exists. ~57 call sites use `.schema("research")`; route them through one
   `researchClient` wrapper and the blast radius is contained. Managed backups and PostgREST keep
   working, which they wouldn't on raw Postgres in Docker.

---

## 8. Also applied

- `research.v_work_queue_drain` created — one `GROUP BY job_type, status` aggregate replacing the
  44 `count(*) exact` scans in `/api/operator/research/drain-status`
  (`src/lib/research/drain-status.ts:212,249`). **The API still needs to be pointed at it** — that's
  a code change, not done here.
- `ops.pgss_snapshot_20260728` — pre-fix top-100 statements preserved.
- `extensions.pg_stat_statements_reset()` run, so the current window starts 2026-07-28 ~03:47 UTC.

---

## 9. What's still open

**Database (small):**
- Point `drain-status` at `research.v_work_queue_drain`.
- Auth connections are pinned at 10 absolute — switch to percentage-based (Dashboard → Auth) now
  that you're on Small.
- Review the ~294 unused indexes in 2–4 weeks, once the reset stats have a fair sample.

**Application code — the entire code half of the plan is untouched.** In value order:
1. `(operator)/loading.tsx` + `staleTimes` + `optimizePackageImports: ["radix-ui"]` — three tiny edits
2. Move the trial-status fetch behind `<Suspense>` in `app-shell.tsx:154`
3. Poll backoff + hidden-tab gating (6 loops, none currently back off)
4. `load-live-bundle.ts:57-134` — up to 23 sequential round trips
5. Local JWT verification to kill the 3-round-trip auth tax on all 100 routes
6. Cache-Control headers (51 of 57 GET routes send none)

**Infra:**
- Check disk headroom (§6).
- Enable Vercel Speed Insights + confirm Fluid Compute is on.
- Reduce `HERMES_QUEUE_LOOP_INTERVAL_MS` on the VPS (§7.2).

---

## Verification summary

| Check | Result |
|---|---|
| Duplicate index groups remaining | **0** (was 137) |
| Unindexed foreign keys remaining | **0** (was 42) |
| `work_queue` dedupe lookup | **2,569 ms → 0.090 ms**; 10,959 → 4 buffers |
| Ads (observed/creatives/media) | **unchanged: 5,146 / 1,603 / 24,400** |
| Database writable | **yes** — verified with a live write probe |
| `default_transaction_read_only` | **off** |
| Dead tuples on purged tables | **0** — autovacuum already reclaimed |
| Active cron jobs | **1** (`research-log-retention`, nightly 02:15 Perth) |
| Compute tier | **Small confirmed** — 90 conns, 512 MB shared_buffers, 1.5 GB effective cache |
