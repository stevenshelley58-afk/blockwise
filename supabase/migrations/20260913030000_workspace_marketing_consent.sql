begin;
create table public.workspace_marketing_consent_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade, granted boolean not null,
 policy_version text not null default '2026-09-13', occurred_at timestamptz not null default statement_timestamp()
);
create index workspace_marketing_consent_events_current_idx on public.workspace_marketing_consent_events(workspace_id,profile_id,occurred_at desc,id desc);
alter table public.workspace_marketing_consent_events enable row level security;
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
commit;