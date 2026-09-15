create schema if not exists legacy_archive;

do $$
begin
  if to_regclass('public.adbuilder_performance_imports') is not null
     and to_regclass('legacy_archive.adbuilder_performance_imports') is null then
    alter table public.adbuilder_performance_imports set schema legacy_archive;
  end if;
end $$;

drop view if exists research.v_operator_work_queue_summary;
drop view if exists research.v_operator_provider_failures;
drop view if exists research.v_operator_missing_media;
drop view if exists research.v_operator_unclassified_creatives;
drop view if exists research.v_operator_page_verification_gaps;
drop view if exists research.v_operator_build_reports;

insert into storage.buckets (id, name, public)
values ('research-ad-creatives', 'research-ad-creatives', true)
on conflict (id) do update
set public = true;
