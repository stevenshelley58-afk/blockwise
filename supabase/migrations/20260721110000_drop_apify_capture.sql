-- Migration: Drop Apify capture infrastructure (post model-cutover)
-- Archives capture_actors, removes apify runtime settings, resets meta_capture_mode.
-- Idempotent: safe to run multiple times.

begin;

-- 1. Archive research.capture_actors to legacy_archive (preserve data per AGENTS.md)
create schema if not exists legacy_archive;

do $$
declare
  row_count bigint;
begin
  if exists (select 1 from information_schema.tables where table_schema = 'research' and table_name = 'capture_actors') then
    select count(*) into row_count from research.capture_actors;
    if row_count > 0 then
      raise notice 'Archiving research.capture_actors with % rows to legacy_archive', row_count;
    end if;
    alter table research.capture_actors set schema legacy_archive;
  else
    raise notice 'research.capture_actors already archived or does not exist';
  end if;
end $$;

-- 2. Remove apify_* runtime settings
delete from research.runtime_settings
where setting_key like 'apify\_%';

-- 3. Reset meta_capture_mode: any 'apify' value -> 'hermes_browser'
update research.runtime_settings
set setting_value = '"hermes_browser"'::jsonb,
    updated_at = now()
where setting_key = 'meta_capture_mode'
  and setting_value::text = '"apify"';

-- 4. Ensure meta_capture_mode exists with correct default
insert into research.runtime_settings (setting_key, setting_value, description)
values ('meta_capture_mode', '"hermes_browser"'::jsonb, 'Meta Ad Library capture provider mode: hermes_browser, official_api, or disabled.')
on conflict (setting_key) do nothing;

commit;
