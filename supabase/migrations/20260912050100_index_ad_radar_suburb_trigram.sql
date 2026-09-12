-- Item 9 of the perf-top20 plan: index the Ad Radar suburb filter.
--
-- Query shape: src/lib/research/public-ad-radar.ts:411 issues
--   .ilike("suburb", escapeLikeTerm(suburb))
-- which PostgREST renders as `suburb ILIKE 'bondi'`. escapeLikeTerm only strips
-- % and _ (public-ad-radar.ts:610), so the pattern has no wildcard, but the
-- operator is still ILIKE (~~*).
--
-- Why trigram and not a btree on lower(suburb): pg_amop on the live database
-- shows only gin_trgm_ops and gist_trgm_ops contain the ~~* operator. No btree
-- operator family supports ~~*, so a btree on lower(suburb) would never be
-- chosen for `.ilike()`. The same index also serves the `%term%` fallback
-- search on suburb (public-ad-radar.ts:441, TEXT_SEARCH_COLUMNS includes
-- "suburb"), which does use a leading wildcard.
--
-- pg_trgm is already installed in the extensions schema (moved by
-- 20260608223047_authz_step3_move_pg_trgm_to_extensions.sql) and the sibling
-- column page_name already uses extensions.gin_trgm_ops, so this matches the
-- existing read-model index style. The CREATE EXTENSION line below is a
-- guarded no-op on this database; on a fresh restore it needs superuser or
-- database-owner privileges, which is why it is not relied upon here.
--
-- Cost note: customer_ad_radar_cards currently holds about 393 rows (well under
-- 1 MB), so the planner may keep choosing a sequential scan until the read
-- model grows. The index is cheap to keep and pays off as ingest grows.

create extension if not exists pg_trgm with schema extensions;

create index if not exists customer_ad_radar_cards_suburb_trgm_idx
  on public.customer_ad_radar_cards using gin (suburb extensions.gin_trgm_ops);
comment on index public.customer_ad_radar_cards_suburb_trgm_idx is
  'Serves Ad Radar suburb ILIKE filters and the suburb text fallback search.';
