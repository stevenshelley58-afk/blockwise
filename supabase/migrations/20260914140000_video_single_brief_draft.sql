-- At most one editable brief draft per project.
--
-- Autosave upserts the customer's working draft, so the database has to be the
-- thing that guarantees there is only one. Without this, two concurrent saves
-- could each insert an unfrozen row, and the order would then freeze whichever
-- it happened to read, which may not be the version the customer last saw.
--
-- Frozen versions are deliberately excluded: a project accumulates frozen
-- history as revisions happen, and every one of those must be kept.

create unique index if not exists video_brief_versions_one_draft_idx
  on public.video_brief_versions (project_id)
  where frozen_at is null;
