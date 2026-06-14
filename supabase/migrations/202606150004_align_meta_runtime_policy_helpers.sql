-- Keep production and preview RLS policy expressions aligned with the auth
-- helper functions that exist in the local migration lineage.

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select p.is_operator from public.profiles p where p.id = (select auth.uid())), false)
    or exists (
      select 1
      from public.workspace_members wm
      where wm.profile_id = (select auth.uid())
        and wm.role = 'operator'
    );
$$;

comment on function public.is_operator() is
  'True for profile-level operators and users assigned the operator workspace role.';

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.profile_id = (select auth.uid())
  );
$$;

drop policy if exists meta_publish_plans_workspace_select on public.meta_publish_plans;
create policy meta_publish_plans_workspace_select on public.meta_publish_plans
  for select
  using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists meta_publish_plan_mutations_workspace_select on public.meta_publish_plan_mutations;
create policy meta_publish_plan_mutations_workspace_select on public.meta_publish_plan_mutations
  for select
  using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists lead_delivery_attempts_workspace_select on public.lead_delivery_attempts;
create policy lead_delivery_attempts_workspace_select on public.lead_delivery_attempts
  for select
  using (public.is_operator() or public.is_workspace_member(workspace_id));
