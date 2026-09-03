-- Ad Studio: allow the "custom" colour mode on customer ads.
-- AdDocument v1 gains colourMode "custom" (per-role customer palette stored in
-- resolvedColourMap). The ad row check constraint must accept it too.
-- Idempotent — safe to re-run.

alter table ad_customer_ads
  drop constraint if exists ad_customer_ads_colour_mode_check;

alter table ad_customer_ads
  add constraint ad_customer_ads_colour_mode_check
  check (colour_mode in ('template', 'brand_pack', 'custom'));
