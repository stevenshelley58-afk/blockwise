alter table research.ad_template_candidates
  drop constraint if exists ad_template_candidates_sample_card_path_check,
  add constraint ad_template_candidates_sample_card_path_check
    check (
      sample_card_image_path is null
      or (
        sample_card_image_path !~ '(^/|[.][.]|^[a-z][a-z0-9+.-]*:)'
        and sample_card_image_path ~ '^[a-zA-Z0-9_/-]+[.]png$'
      )
    );;
