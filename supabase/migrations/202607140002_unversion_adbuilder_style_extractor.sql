begin;

alter table research.ad_style_profiles
  alter column extractor_version set default 'style-extractor';

commit;
