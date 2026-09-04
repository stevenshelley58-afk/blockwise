-- The pre-correction visual scores are not approval evidence. Preserve every
-- row and asset, but remove all existing templates from customer discovery.

update public.ad_templates
set
  library_status = 'quarantined',
  library_review_run_id = null,
  library_reviewed_at = null
where library_status <> 'quarantined'
   or library_review_run_id is not null
   or library_reviewed_at is not null;
