-- Allow multiple leads in a workspace to share an identity key while keeping
-- exactly one dedupe record per lead.

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, lead_id
      order by created_at desc, id desc
    ) as row_number
  from public.lead_dedupe_records
)
delete from public.lead_dedupe_records records
using ranked
where records.id = ranked.id
  and ranked.row_number > 1;

alter table public.lead_dedupe_records
  drop constraint if exists lead_dedupe_records_workspace_id_dedupe_key_key;

drop index if exists public.lead_dedupe_records_workspace_id_dedupe_key_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lead_dedupe_records'::regclass
      and conname = 'lead_dedupe_records_workspace_id_lead_id_key'
  ) then
    alter table public.lead_dedupe_records
      add constraint lead_dedupe_records_workspace_id_lead_id_key unique (workspace_id, lead_id);
  end if;
end $$;
