-- Ad studio rename: move the trial-signup database objects off the old
-- self-serve name. The app is not live on the old name and no second name is
-- kept at the product level.
--
-- The migration *filename* rule from 20260915000100 applies here too: the
-- applied files keep their original filenames as ledger keys, so object names
-- inside 202606040004_self_serve_trial.sql already use the new spelling and a
-- fresh install creates them directly. A database that predates the rename
-- still carries the old names, and this migration moves them in place.
--
-- ALTER ... RENAME keeps OIDs, so the table trigger that binds this function
-- stays attached and no grant is lost. The final assertion aborts the
-- transaction if an old name survives.

-- Move the trigger first: it binds by OID, so the function rename below cannot
-- detach it.
do $$
begin
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'on_trial_self_serve_signup'
      and not t.tgisinternal
  ) then
    alter trigger on_trial_self_serve_signup on auth.users
      rename to on_trial_ad_studio_signup;
    raise notice 'renamed trigger auth.users.on_trial_self_serve_signup';
  end if;
end
$$;

-- Move the trigger function. Its argument list is unchanged, so the identity
-- form of ALTER FUNCTION is enough.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_trial_self_serve_signup'
  ) then
    alter function public.handle_trial_self_serve_signup() rename to handle_trial_ad_studio_signup;
    raise notice 'renamed function public.handle_trial_self_serve_signup';
  end if;
end
$$;

-- Fail loudly rather than leaving a half-renamed name behind.
do $$
declare
  leftover text;
begin
  select string_agg(item, ', ' order by item) into leftover
  from (
    select 'function public.' || p.proname as item
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%self_serve%'
    union all
    select 'trigger auth.' || c.relname || '.' || t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and t.tgname like '%self_serve%'
  ) leftovers;

  if leftover is not null then
    raise exception 'Ad studio rename incomplete, old names remain: %', leftover;
  end if;
end
$$;
