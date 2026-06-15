-- Fix the over-escaped sample-card path check constraint.
--
-- Migration 202606150009 wrote the regexes with doubled backslashes
-- ('\\.png$' and '\\.\\.'). Under standard_conforming_strings the stored
-- pattern becomes a *literal backslash* before "png", so NO valid object path
-- (e.g. adstudio-samples/v1/hv-01.png) can ever satisfy it. This blocked the
-- template-library seed from writing sample_card_image_path / creative_skeleton.
--
-- Re-create the constraint using bracketed dots ([.]) which need no escaping and
-- mean exactly one literal dot, so the rule is correct regardless of backslash
-- handling. Behaviour: allow null, reject absolute paths, parent-dir traversal
-- ("..") and URI schemes, and require a relative "*.png" object path.

alter table research.ad_template_candidates
  drop constraint if exists ad_template_candidates_sample_card_path_check,
  add constraint ad_template_candidates_sample_card_path_check
    check (
      sample_card_image_path is null
      or (
        sample_card_image_path !~ '(^/|[.][.]|^[a-z][a-z0-9+.-]*:)'
        and sample_card_image_path ~ '^[a-zA-Z0-9_/-]+[.]png$'
      )
    );
