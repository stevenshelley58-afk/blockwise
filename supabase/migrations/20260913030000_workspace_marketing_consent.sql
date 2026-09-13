-- Adopt only the exact empty table left by the interrupted prelaunch rehearsal.
-- Transaction ownership belongs to product-migrate.sh, including its ledger insert.
do $adopt$
begin
 if to_regclass('public.workspace_marketing_consent_events') is not null then
  if exists(select 1 from public.workspace_marketing_consent_events) then
   raise exception 'Unledgered consent table is non-empty; explicit reconciliation required';
  end if;
  if (select array_agg(column_name || ':' || data_type || ':' || is_nullable order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='workspace_marketing_consent_events') is distinct from array['id:uuid:NO','workspace_id:uuid:NO','profile_id:uuid:NO','granted:boolean:NO','policy_version:text:NO','occurred_at:timestamp with time zone:NO'] then
   raise exception 'Unexpected unledgered consent table shape';
  end if;
  if (select array_agg(pg_get_constraintdef(oid) order by pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.workspace_marketing_consent_events'::regclass) is distinct from array['FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE','FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE','PRIMARY KEY (id)'] then
   raise exception 'Unexpected unledgered consent constraints';
  end if;
 end if;
end $adopt$;
create table if not exists public.workspace_marketing_consent_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade, granted boolean not null,
 policy_version text not null default '2026-09-13', occurred_at timestamptz not null default statement_timestamp()
);
create index if not exists workspace_marketing_consent_events_current_idx on public.workspace_marketing_consent_events(workspace_id,profile_id,occurred_at desc,id desc);
alter table public.workspace_marketing_consent_events alter column id set default gen_random_uuid(), alter column policy_version set default '2026-09-13', alter column occurred_at set default statement_timestamp();
alter table public.workspace_marketing_consent_events enable row level security;
drop policy if exists workspace_marketing_consent_events_select_own on public.workspace_marketing_consent_events;
create policy workspace_marketing_consent_events_select_own on public.workspace_marketing_consent_events for select using(profile_id=auth.uid() and public.is_workspace_member(workspace_id));
create or replace function public.record_workspace_marketing_consent(p_workspace_id uuid,p_granted boolean) returns public.workspace_marketing_consent_events language plpgsql security definer set search_path='' as $$
declare e public.workspace_marketing_consent_events;
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then raise exception 'workspace consent access denied' using errcode='42501'; end if;
 if p_granted and not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then raise exception 'verified email required' using errcode='42501'; end if;
 insert into public.workspace_marketing_consent_events(workspace_id,profile_id,granted) values(p_workspace_id,auth.uid(),p_granted) returning * into e; return e;
end $$;
revoke all on table public.workspace_marketing_consent_events from public,anon,authenticated; grant select on public.workspace_marketing_consent_events to authenticated;
revoke all on function public.record_workspace_marketing_consent(uuid,boolean) from public,anon; grant execute on function public.record_workspace_marketing_consent(uuid,boolean) to authenticated;
