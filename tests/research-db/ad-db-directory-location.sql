-- Run against the isolated schema rehearsal database, never as a paid collection.
begin;
do $$
declare
  agent uuid := gen_random_uuid();
  agency uuid := gen_random_uuid();
  page uuid := gen_random_uuid();
  ad uuid := gen_random_uuid();
  places jsonb;
begin
  insert into research.agencies(id,name,state,primary_postcode,primary_suburb)
    values(agency,'Location fallback fixture agency','WA','6000','Perth');
  insert into research.agents(id,full_name,state,primary_postcode,primary_suburb,agency_id)
    values(agent,'Location fallback fixture agent','WA','6000','Perth',agency);
  insert into research.advertiser_pages(id,platform,page_name,page_id,agent_id,agency_id)
    values(page,'facebook','Location fallback fixture page','9999999999999001',agent,agency);
  insert into research.observed_ads(id,external_ad_id,advertiser_page_id,first_seen_provider)
    values(ad,'fixture-ad-location-1',page,'test');
  select locations into places from research.v_ad_db_ads where id=ad;
  if not places @> '[{"postcode":"6000","state":"WA","suburb":"Perth","relation":"office"}]'::jsonb
    then raise exception 'Agent postcode disappeared when location FK was missing'; end if;
  if jsonb_array_length(places) <> 1
    then raise exception 'Identical agent and agency fallback duplicated'; end if;
  update research.advertiser_pages set agent_id=null where id=page;
  select locations into places from research.v_ad_db_ads where id=ad;
  if not places @> '[{"postcode":"6000","state":"WA","relation":"office"}]'::jsonb
    then raise exception 'Agency postcode disappeared when agent was absent'; end if;
  update research.agencies set primary_postcode=null where id=agency;
  select locations into places from research.v_ad_db_ads where id=ad;
  if places <> '[]'::jsonb then raise exception 'Invented location for an unknown office'; end if;
end;
$$;
rollback;
