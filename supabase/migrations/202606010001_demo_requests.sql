create extension if not exists pgcrypto;

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  agency text,
  email text not null,
  phone text,
  suburb text,
  message text,
  source text not null default 'landing',
  user_agent text,
  referrer text
);

alter table public.demo_requests enable row level security;

-- Public marketing form: allow anonymous + authenticated visitors to INSERT only,
-- with DB-level shape constraints (the anon key is publicly exposed via the client,
-- so a direct REST call must not be able to write junk or oversized values).
-- No SELECT/UPDATE/DELETE policies exist, so reads remain denied to anon/authenticated;
-- only the service-role key (which bypasses RLS) can read submissions.
drop policy if exists demo_requests_public_insert on public.demo_requests;
create policy demo_requests_public_insert
  on public.demo_requests
  for insert
  to anon, authenticated
  with check (
    source = 'landing'
    and char_length(name) between 1 and 120
    and char_length(email) between 3 and 200
    and email like '%_@_%.__%'
    and char_length(coalesce(agency, '')) <= 160
    and char_length(coalesce(phone, '')) <= 40
    and char_length(coalesce(suburb, '')) <= 120
    and char_length(coalesce(message, '')) <= 2000
  );

comment on table public.demo_requests is 'Inbound demo/access requests from the marketing landing page.';
