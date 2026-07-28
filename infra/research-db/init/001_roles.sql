do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- The source research schema historically carried an empty customer performance
-- table with foreign keys into public. These minimal tables let the one-time
-- schema restore resolve those foreign keys. The restore script removes the
-- migrated research table and all three stubs after the data load.
create table if not exists public.workspaces (
  id uuid primary key
);

create table if not exists public.adstudio_campaigns (
  id uuid primary key
);

create table if not exists public.adstudio_creatives (
  id uuid primary key
);

create or replace function public.is_operator()
returns boolean
language sql
stable
as $$
  select false
$$;
