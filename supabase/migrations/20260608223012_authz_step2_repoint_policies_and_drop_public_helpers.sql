-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260608223012; restored to source control here.

-- B1: repoint the two internal callers to the private helpers (behaviour unchanged).
create or replace function public.get_trial_status(target_workspace_id uuid)
 returns table(plan_key text, trial_ends_at timestamp with time zone, ad_packs_used integer, ad_packs_limit integer, ad_packs_remaining integer, trial_days_remaining integer, trial_expired boolean)
 language sql stable security definer set search_path to 'public'
as $gt$
  select
    wp.key as plan_key,
    w.trial_ends_at,
    coalesce(rl.used_count, 0)::integer as ad_packs_used,
    coalesce(rl.limit_count, 0)::integer as ad_packs_limit,
    greatest(coalesce(rl.limit_count, 0) - coalesce(rl.used_count, 0), 0)::integer as ad_packs_remaining,
    case
      when w.trial_ends_at is null then 0
      else greatest(ceil(extract(epoch from (w.trial_ends_at - now())) / 86400.0)::integer, 0)
    end as trial_days_remaining,
    coalesce(wp.key = 'trial' and (w.trial_ends_at is null or w.trial_ends_at <= now()), false) as trial_expired
  from public.workspaces w
  left join public.workspace_plans wp on wp.id = w.plan_id
  left join public.rate_limits rl
    on rl.workspace_id = w.id and rl.subject_key = 'ad_pack_generation' and rl.bucket = 'trial'
  where w.id = target_workspace_id
    and (private.is_operator() or private.is_workspace_member(w.id));
$gt$;

create or replace function public.adstudio_install_workspace_policies(target_table regclass)
 returns void language plpgsql security definer set search_path to 'public'
as $inst$
begin
  execute format('drop policy if exists adstudio_workspace_select on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_insert on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_update on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_delete on %s', target_table);
  execute format('create policy adstudio_workspace_select on %s for select using (private.adstudio_has_workspace_access(workspace_id))', target_table);
  execute format('create policy adstudio_workspace_insert on %s for insert with check (private.adstudio_has_workspace_access(workspace_id))', target_table);
  execute format('create policy adstudio_workspace_update on %s for update using (private.adstudio_has_workspace_access(workspace_id)) with check (private.adstudio_has_workspace_access(workspace_id))', target_table);
  execute format('create policy adstudio_workspace_delete on %s for delete using (private.adstudio_has_workspace_access(workspace_id))', target_table);
end;
$inst$;

-- B2: repoint every policy that calls the helpers (public + storage) to private.*,
-- and wrap bare auth.uid() as (select auth.uid()). \m = zero-width start-of-word (handles nested calls).
do $do$
declare r record; nq text; nwc text; using_clause text; check_clause text;
begin
  for r in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname in ('public','storage')
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
          '\m(is_operator|is_workspace_member|has_workspace_role|adstudio_has_workspace_access|workspace_id_from_storage_path)[[:space:]]*\('
  loop
    nq := r.qual; nwc := r.with_check;
    if nq is not null then
      nq := regexp_replace(nq, '\m(is_operator|is_workspace_member|has_workspace_role|adstudio_has_workspace_access|workspace_id_from_storage_path)[[:space:]]*\(', 'private.\1(', 'g');
      nq := regexp_replace(nq, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    end if;
    if nwc is not null then
      nwc := regexp_replace(nwc, '\m(is_operator|is_workspace_member|has_workspace_role|adstudio_has_workspace_access|workspace_id_from_storage_path)[[:space:]]*\(', 'private.\1(', 'g');
      nwc := regexp_replace(nwc, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    end if;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    using_clause := case when nq is not null and btrim(nq) <> '' then ' using (' || nq || ')' else '' end;
    check_clause := case when nwc is not null and btrim(nwc) <> '' then ' with check (' || nwc || ')' else '' end;
    execute format('create policy %I on %I.%I as %s for %s to %s%s%s',
       r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
       array_to_string(r.roles, ', '), using_clause, check_clause);
  end loop;
end
$do$;

-- B3: assert no policy still references an UNqualified helper (strip private.* refs, then look for bare names).
do $do$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname in ('public','storage')
     and regexp_replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
           'private\.(is_operator|is_workspace_member|has_workspace_role|adstudio_has_workspace_access|workspace_id_from_storage_path)[[:space:]]*\(', '', 'g')
         ~ '\m(is_operator|is_workspace_member|has_workspace_role|adstudio_has_workspace_access|workspace_id_from_storage_path)[[:space:]]*\(';
  if n > 0 then raise exception 'assertion failed: % policies still reference unqualified helpers', n; end if;
end
$do$;

-- B4: drop the public helpers (catalog dependency makes this fail+rollback if any policy still points at them).
drop function public.is_operator();
drop function public.is_workspace_member(uuid);
drop function public.has_workspace_role(uuid, text[]);
drop function public.adstudio_has_workspace_access(uuid);
drop function public.workspace_id_from_storage_path(text);
