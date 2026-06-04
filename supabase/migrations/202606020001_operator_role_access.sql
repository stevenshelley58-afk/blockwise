-- Align the database operator helper with the app's operator membership role.
-- This keeps the existing profiles.is_operator flag while allowing users with
-- workspace_members.role = 'operator' to pass operator-only research RLS.

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select p.is_operator from public.profiles p where p.id = auth.uid()), false)
    or exists (
      select 1
      from public.workspace_members wm
      where wm.profile_id = auth.uid()
        and wm.role = 'operator'
    );
$$;

comment on function public.is_operator() is
  'True for profile-level operators and users assigned the operator workspace role.';
