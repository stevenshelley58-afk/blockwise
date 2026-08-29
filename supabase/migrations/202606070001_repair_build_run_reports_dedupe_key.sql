-- Repair live drift where build_run_reports lost the dedupe conflict target.
-- Watchdog RPCs use ON CONFLICT (dedupe_key); without this index they fail
-- every supervisor tick with SQLSTATE 42P10.

with ranked as (
  select
    id,
    dedupe_key,
    row_number() over (
      partition by dedupe_key
      order by last_seen_at desc, created_at desc, id desc
    ) as rn,
    sum(occurrences) over (partition by dedupe_key) as total_occurrences,
    min(first_seen_at) over (partition by dedupe_key) as earliest_first_seen_at,
    max(last_seen_at) over (partition by dedupe_key) as latest_last_seen_at
  from research.build_run_reports
  where dedupe_key is not null
),
keepers as (
  update research.build_run_reports brr
  set
    occurrences = greatest(1, ranked.total_occurrences),
    first_seen_at = ranked.earliest_first_seen_at,
    last_seen_at = ranked.latest_last_seen_at
  from ranked
  where brr.id = ranked.id
    and ranked.rn = 1
  returning brr.id
)
delete from research.build_run_reports brr
using ranked
where brr.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists build_run_reports_dedupe_key_uidx
  on research.build_run_reports (dedupe_key);

notify pgrst, 'reload schema';
