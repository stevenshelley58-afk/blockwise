# National rollout (HELD — Perth-first)

This seed lives OUTSIDE supabase/migrations/ on purpose, so `supabase db push`
during a deploy will NOT seed the whole country.

When ready to crawl all of Australia, apply:
    ops/national-rollout/202606020001_seed_national_postcodes.sql

It seeds research.refresh_policies for ~2,845 postcodes (priority 1=Perth .. 6=NT),
widens the priority CHECK to 1..6, and is idempotent (ON CONFLICT DO UPDATE).
Spend is capped by HERMES_DAILY_SPEND_LIMIT_USD ($25/day).
