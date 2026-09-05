-- Slug-placeholder pages cannot be scanned by Page ID.
--
-- The 891 verified_real_estate_unresolved pages carry resolver placeholders
-- (page_id like 'slug:<vanity-name>') instead of a real Meta Page ID. They are
-- excluded from the Page-ID acquisition spine until
-- blockwise-page-resolver attaches a real numeric page_id — which must also
-- re-enable scanning.
update research.advertiser_pages
set scan_enabled = false,
    scan_state = 'paused',
    metadata = metadata || jsonb_build_object(
      'scan_disabled_reason', 'unresolved_slug_page_id',
      'scan_disabled_at', now()
    )
where page_id like 'slug:%';
