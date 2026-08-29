-- Launch shutdown for Ad Radar. This migration preserves every row, storage
-- object, queue, and feature source: it changes only access controls and the
-- bucket access model. It intentionally performs no table or storage-object
-- deletion, truncation, archival, or rename.
begin;

alter table public.customer_ad_radar_cards enable row level security;
revoke all on table public.customer_ad_radar_cards from anon, authenticated;
grant all on table public.customer_ad_radar_cards to service_role;
drop policy if exists customer_ad_radar_cards_public_read on public.customer_ad_radar_cards;

alter table public.customer_ad_radar_creative_versions enable row level security;
revoke all on table public.customer_ad_radar_creative_versions from anon, authenticated;
grant all on table public.customer_ad_radar_creative_versions to service_role;
drop policy if exists customer_ad_radar_creative_versions_authenticated_read on public.customer_ad_radar_creative_versions;

alter table public.property_checks enable row level security;
revoke all on table public.property_checks from anon, authenticated;
grant all on table public.property_checks to service_role;

revoke all on function public.search_customer_meta_ad_library_cards(text, integer, text) from public;
revoke all on function public.search_customer_meta_ad_library_cards(text, integer, text) from anon, authenticated;
grant execute on function public.search_customer_meta_ad_library_cards(text, integer, text) to service_role;

-- Updating the bucket flag makes every existing object private without moving
-- or deleting it. Access remains governed by storage.objects RLS and the
-- service-role publisher.
update storage.buckets
set public = false
where id = 'research-ad-creatives'
  and public is distinct from false;

commit;
