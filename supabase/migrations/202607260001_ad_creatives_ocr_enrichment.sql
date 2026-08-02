-- Add OCR-extracted text columns to research.ad_creatives.
-- Enables text search and classification enrichment for text baked into
-- ad creative images (headlines, CTAs, property details rendered as graphics).

alter table research.ad_creatives
  add column if not exists ocr_text text,
  add column if not exists ocr_status text
    check (ocr_status in ('pending', 'done', 'empty', 'failed', 'skipped'));

comment on column research.ad_creatives.ocr_text is
  'Text extracted from ad creative images via OCR (tesseract). Null when not yet attempted.';
comment on column research.ad_creatives.ocr_status is
  'OCR processing state: pending=queued, done=text extracted, empty=no text found, failed=error, skipped=no image available.';

-- Index for the OCR backfill worker to find unprocessed creatives efficiently.
create index if not exists ad_creatives_ocr_pending_idx
  on research.ad_creatives (created_at asc)
  where ocr_status is null or ocr_status = 'pending';

-- Trigram index on ocr_text for fuzzy text search alongside headline/body.
create index if not exists ad_creatives_ocr_text_trgm_idx
  on research.ad_creatives using gin (ocr_text gin_trgm_ops)
  where ocr_text is not null and ocr_text <> '';

-- Customer Ad Radar is now published through public.customer_ad_radar_cards by
-- the VPS research runtime. Do not recreate the retired research-schema view
-- here: its historical projection referenced columns that never existed on
-- advertiser_pages and made fresh migration replay fail.
