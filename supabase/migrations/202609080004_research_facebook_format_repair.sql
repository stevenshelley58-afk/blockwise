-- Repair Facebook vanity values that were truncated by the historical slug
-- migration. This is bounded to unresolved Facebook pages and derives a
-- vanity only from an allowed, page-shaped URL.
--
-- No-op guard: the research schema was retired by the 20260728 VPS cutover,
-- and research.advertiser_pages.page_vanity never existed in this migration
-- lineage, so databases built from this chain skip the repair with a notice
-- instead of failing. Databases that still carry a pre-cutover table with
-- the column get the original repair below.

do $$
begin
  if to_regclass('research.advertiser_pages') is null
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'research'
        and table_name = 'advertiser_pages'
        and column_name = 'page_vanity'
    )
  then
    raise notice 'Skipping 202609080004: research.advertiser_pages.page_vanity is absent.';
    return;
  end if;

with normalized as (
  select ap.id, ap.page_id, ap.page_vanity as original_page_vanity,
    ap.page_url as original_page_url,
    regexp_replace(btrim(ap.page_url), '/+$', '') as normalized_page_url
  from research.advertiser_pages ap
  where ap.platform = 'facebook' and ap.page_id is null and ap.page_url is not null
), classified as (
  select n.*,
    lower(split_part(split_part(n.normalized_page_url, '/', 3), ':', 1)) as host,
    case
      when n.normalized_page_url ~* '^https?://(www\.)?facebook\.com/[A-Za-z0-9][A-Za-z0-9._-]*$' then 'vanity_path'
      when n.normalized_page_url ~* '^https?://(www\.)?facebook\.com/people/[A-Za-z0-9][A-Za-z0-9._-]*/[0-9]+$' then 'people_name_numeric'
      when n.normalized_page_url ~* '^https?://(www\.)?facebook\.com/pages/[A-Za-z0-9][A-Za-z0-9._-]*/[0-9]+$' then 'pages_name_numeric'
      when n.normalized_page_url ~* '^https?://(www\.)?facebook\.com/profile\.php\?id=[0-9]+$' then 'profile_numeric_id'
      else null
    end as url_kind
  from normalized n
), candidates as (
  select c.*,
    case c.url_kind
      when 'vanity_path' then substring(c.normalized_page_url from '/([^/]+)$')
      when 'people_name_numeric' then substring(c.normalized_page_url from '/people/([^/]+)/[0-9]+$')
      when 'pages_name_numeric' then substring(c.normalized_page_url from '/pages/([^/]+)/[0-9]+$')
      else null
    end as repaired_page_vanity
  from classified c
), safe_candidates as (
  select c.*
  from candidates c
  where c.host in ('facebook.com', 'www.facebook.com')
    and c.url_kind in ('vanity_path', 'people_name_numeric', 'pages_name_numeric')
    and not (c.url_kind = 'vanity_path' and (lower(c.repaired_page_vanity) in ('ads', 'group', 'groups', 'photo', 'photos', 'post', 'posts', 'profile.php', 'share', 'sharer', 'plugin', 'plugins', 'dialog', 'login', 'help', 'tr', 'events', 'reel', 'reels', 'watch', 'stories', 'videos', 'pages', 'people') or c.repaired_page_vanity ~ '^[0-9]+$'))
)
update research.advertiser_pages ap
set page_vanity = c.repaired_page_vanity,
    metadata = ap.metadata || jsonb_build_object(
      'facebook_page_vanity_repair', jsonb_build_object(
        'migration', '202609080004_research_facebook_format_repair',
        'source', 'original_page_url', 'original_page_id', c.page_id,
        'original_page_vanity', c.original_page_vanity,
        'original_page_url', c.original_page_url,
        'normalized_page_url', c.normalized_page_url,
        'url_kind', c.url_kind, 'repaired_page_vanity', c.repaired_page_vanity,
        'recorded_at', now()
      )
    ),
    updated_at = now()
from safe_candidates c
where ap.id = c.id and ap.page_id is null
  and ap.page_vanity is distinct from c.repaired_page_vanity;
end
$$;

do $$
begin
  if to_regclass('research.advertiser_pages') is null
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'research'
        and table_name = 'advertiser_pages'
        and column_name = 'page_vanity'
    )
  then
    return;
  end if;

comment on column research.advertiser_pages.page_vanity is
  'Conservative Facebook vanity derived from a trustworthy page URL; never a guessed numeric ID.';
end
$$;
