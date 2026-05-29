# Blockwise discovery worker

Loops every 6 hours, runs the Apify Meta Ad Library search for each
query in `src/queries.ts`, dedupes pageIds across results, and
upserts new `advertiser_pages` rows into Supabase.

The orchestrator picks up the new pages on its next tick — no
manual seeding required.

Cost per cycle: ~\$0.30–\$0.50 depending on dataset sizes.
Each cycle surfaces 50–200 new advertiser pages.
