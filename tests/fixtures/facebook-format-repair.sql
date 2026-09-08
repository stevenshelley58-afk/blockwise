
\set ON_ERROR_STOP on
begin;
do $$ begin
 if current_database() !~ '^ad_radar_fb_rehearsal_' then raise exception 'Wrong rehearsal DB'; end if;
end $$;
create temp table before_repair as select * from research.advertiser_pages;
create temp table format_cases(url text, expected text);
insert into format_cases values
('  https://www.facebook.com/ValidHandle///  ','ValidHandle'),
('https://facebook.com/123MainStreet','123MainStreet'),
('https://facebook.com/123456',null),
('https://facebook.com/groups',null),
('https://facebook.com/posts/123',null),
('https://facebook.com/profile.php?id=123456',null),
('https://facebook.com/login',null),
('https://facebook.com/ads',null),
('https://facebook.com/profile.php',null),
('https://facebook.com/people/Valid-Name/123456','Valid-Name'),
('https://facebook.com/pages/Valid-Name/123456','Valid-Name'),
('https://user@facebook.com/Handle',null),
('https://facebook.com:8443/Handle',null),
('https://facebook.com/Handle?ref=other',null),
('https://notfacebook.com/Handle',null),
('https://facebook.com.evil.example/Handle',null),
('https://facebook.com/Handle/posts/123',null);
insert into research.advertiser_pages(platform,page_name,page_url,page_vanity,status,scan_enabled,metadata)
select 'facebook','format-rehearsal-fixture',url,'unchanged','verified_real_estate_unresolved',false,'{"keep":"original"}'::jsonb from format_cases;
\ir ../../supabase/migrations/202609080004_research_facebook_format_repair.sql

do $$ begin
 if exists(select 1 from research.advertiser_pages p join format_cases c on c.url=p.page_url
 where p.page_vanity is distinct from coalesce(c.expected,'unchanged'))
 then raise exception 'URL fixture normalization failed'; end if;
 if exists(select 1 from before_repair b join research.advertiser_pages p on p.id=b.id
 where (to_jsonb(p) - array['page_vanity','metadata','updated_at'])
 is distinct from (to_jsonb(b) - array['page_vanity','metadata','updated_at'])
 or (p.metadata-'facebook_page_vanity_repair') is distinct from (b.metadata-'facebook_page_vanity_repair'))
 then raise exception 'Unrelated data changed'; end if;

end $$;
select count(*) as existing_handles_repaired from research.advertiser_pages p join before_repair b on b.id=p.id where p.page_vanity is distinct from b.page_vanity;
create temp table after_first as select * from research.advertiser_pages;
\ir ../../supabase/migrations/202609080004_research_facebook_format_repair.sql

do $$ begin
 if exists(select 1 from research.advertiser_pages p full join after_first a on a.id=p.id where to_jsonb(p) is distinct from to_jsonb(a))
 then raise exception 'Migration is not idempotent'; end if;
end $$;
select 'PASS:17 URLfixtures,unrelated data unchanged,idempotent' as result;
rollback;
