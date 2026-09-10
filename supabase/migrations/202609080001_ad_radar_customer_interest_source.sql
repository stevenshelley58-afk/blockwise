-- Durable, service-only product source for explicit Ad Radar interests.
--
-- The signup form may carry a postcode from the suburb-report handoff. Keep
-- that signal in the customer database so the isolated research runtime can
-- synchronize it without reading auth metadata or guessing an identity.
create table if not exists public.ad_radar_customer_interest_sources (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  postcode text,
  state text,
  agent_id uuid,
  advertiser_page_id uuid,
  source text not null default 'signup',
  intent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_radar_customer_interest_sources_postcode_check
    check (postcode is null or postcode ~ '^[0-9]{4}$'),
  constraint ad_radar_customer_interest_sources_state_check
    check (state is null or length(state) between 2 and 32),
  constraint ad_radar_customer_interest_sources_source_check
    check (source in ('signup', 'profile', 'manual', 'backfill')),
  constraint ad_radar_customer_interest_sources_intent_check
    check (intent is null or intent in ('track', 'remix', 'trial'))
);

comment on table public.ad_radar_customer_interest_sources is
  'Private product-side Ad Radar interest inputs. Service-role sync only; no customer PII or guessed identities.';

create index if not exists ad_radar_customer_interest_sources_active_idx
  on public.ad_radar_customer_interest_sources (active, updated_at desc);
create index if not exists ad_radar_customer_interest_sources_postcode_idx
  on public.ad_radar_customer_interest_sources (postcode)
  where active = true and postcode is not null;

alter table public.ad_radar_customer_interest_sources enable row level security;
revoke all on public.ad_radar_customer_interest_sources from public, anon, authenticated;
grant all on public.ad_radar_customer_interest_sources to service_role;

-- The existing trial bootstrap creates public.profiles before its workspace.
-- Capture the auth metadata at that boundary; the runtime later joins the
-- profile to its owner workspace through public.workspace_members.
create or replace function private.capture_ad_radar_signup_interest()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_metadata jsonb;
  v_postcode text;
  v_source text;
  v_intent text;
begin
  select coalesce(raw_user_meta_data, '{}'::jsonb)
    into v_metadata
  from auth.users
  where id = new.id;

  if coalesce(v_metadata->>'signup_flow', '') <> 'trial_self_serve' then
    return new;
  end if;

  v_postcode := nullif(btrim(v_metadata->>'ad_radar_postcode'), '');
  if v_postcode is not null and v_postcode !~ '^[0-9]{4}$' then
    v_postcode := null;
  end if;
  v_source := 'signup';
  v_intent := case when v_metadata->>'ad_radar_intent' in ('track', 'remix', 'trial') then v_metadata->>'ad_radar_intent' else null end;

  insert into public.ad_radar_customer_interest_sources (
    profile_id, postcode, source, intent, active
  )
  values (new.id, v_postcode, v_source, v_intent, true)
  on conflict (profile_id) do update
  set postcode = excluded.postcode,
      source = excluded.source,
      intent = excluded.intent,
      active = true,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists capture_ad_radar_signup_interest on public.profiles;
create trigger capture_ad_radar_signup_interest
  after insert on public.profiles
  for each row execute function private.capture_ad_radar_signup_interest();

-- Existing trial users created before the handoff was persisted are included
-- when they have an explicit stored signal. No names are used for matching.
insert into public.ad_radar_customer_interest_sources (
  profile_id, postcode, source, intent, active
)
select
  p.id,
  case
    when nullif(btrim(u.raw_user_meta_data->>'ad_radar_postcode'), '') ~ '^[0-9]{4}$'
      then btrim(u.raw_user_meta_data->>'ad_radar_postcode')
    else null
  end,
  'backfill',
  case
    when u.raw_user_meta_data->>'ad_radar_intent' in ('track', 'remix', 'trial')
      then u.raw_user_meta_data->>'ad_radar_intent'
    else null
  end,
  true
from public.profiles p
join auth.users u on u.id = p.id
where coalesce(u.raw_user_meta_data->>'signup_flow', '') = 'trial_self_serve'
  and u.raw_user_meta_data ? 'ad_radar_postcode'
on conflict (profile_id) do update
set postcode = coalesce(excluded.postcode, public.ad_radar_customer_interest_sources.postcode),
    intent = coalesce(excluded.intent, public.ad_radar_customer_interest_sources.intent),
    active = excluded.active,
    updated_at = now();
